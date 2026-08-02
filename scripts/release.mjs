import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Cuts a release locally: capture the release notes with git-cliff, prepend the same
 * section to CHANGELOG.md, bump the version, commit, tag, push, and publish the GitHub
 * release from those notes. The capture comes first on purpose — it is the last moment
 * at which the run can be abandoned (empty notes) with nothing yet written.
 *
 * Releases are deliberately NOT automated in CI — they run here, under the invoker's own
 * `git`/`gh` credentials (`npm run release`). This file ships downstream with the
 * template, where it is optional local tooling.
 *
 * Shape mirrors `reset-release-state.mjs`: a pure decision core ({@link planRelease})
 * plus a thin `import.meta.main` CLI that does all the impure gathering and executing.
 * Progress is written with `process.stdout.write`; never `console.log` (`no-console`).
 * Unlike that module this one runs only after `npm install`, so importing from
 * `node_modules` would be legal — it just doesn't need to.
 */

/**
 * The version a repo with no `vX.Y.Z` tag yet releases as, whatever git-cliff computed
 * from the template history it inherited.
 */
const FIRST_RELEASE_VERSION = '0.1.0';

/**
 * The conventional-commit types `cliff.toml` maps to a changelog section, in that file's
 * order. Everything else is swallowed by its trailing catch-all parser, so a window of
 * nothing but `chore`/`build`/`docs`/`ci` commits produces no bump at all. Named here only
 * so the refusals can tell the maintainer *which* types would have counted — the mapping
 * itself lives in `cliff.toml`.
 *
 * Exported for the coupling test in `reset-release-state.test.mjs` (the `cliff.toml`
 * suite), which decodes that file's `commit_parsers` and fails if the two drift apart.
 * Drift is invisible at runtime and produces a confidently wrong refusal message, so the
 * test is the only thing holding them together — do not edit one side alone.
 */
export const RELEASABLE_TYPES = 'feat, fix, perf, revert, deprecate, security';

/**
 * The only version shape this flow can carry through end to end: three plain numbers.
 *
 * Deliberately as strict as `cliff.toml`'s `tag_pattern`, pre-release suffixes included —
 * `v1.2.3-rc.1` would tag fine and then leave the release AFTER it with no baseline the
 * pattern can match. Anything else reaching {@link planRelease} is a bug or a broken
 * `cliff.toml`, and either way must not be spliced into a tag name.
 */
const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Recognises the release commit this script itself writes, and captures its version.
 *
 * **Coupled to the `git commit -m` argv in {@link planRelease}** — the two must keep spelling
 * the subject the same way or the already-bumped guard silently stops firing. The coupling
 * test in `release.test.mjs` ("detects the release commit its own plan writes") feeds a
 * planned subject straight back in, so the drift fails a test rather than a release.
 */
const RELEASE_COMMIT_SUBJECT_PATTERN = /^chore\(release\): v(\d+\.\d+\.\d+)$/;

/**
 * Explain a no-bump window to a maintainer who cannot see git-cliff's filtering.
 *
 * "No releasable commits" reads as "nothing happened", which is wrong and confusing the
 * moment a batch of merged Dependabot PRs is sitting on the default branch. Separating
 * the two cases is the whole point.
 *
 * @param {number} commitCount Commits between the last matching tag and `HEAD`.
 * @returns {string} A refusal reason, plain-language and actionable.
 */
function nothingReleasableReason(commitCount) {
	if (commitCount <= 0) return 'there are no commits at all since the last release';

	const counted = commitCount === 1 ? 'there is 1 commit' : `there are ${commitCount} commits`;
	return (
		`${counted} since the last release, but none of a type that appears in the changelog ` +
		`(${RELEASABLE_TYPES}) — chore, build, docs and ci commits are excluded by design. ` +
		'To ship them anyway, land one commit of a listed type (for example ' +
		'`git commit --allow-empty -m "fix: refresh dependencies"`) and run `npm run release` again.'
	);
}

/**
 * Explain that the repo has released before, but not under a tag the tooling can read.
 *
 * The CLI's gathering glob (`v[0-9]*`) is deliberately LOOSER than `cliff.toml`'s anchored
 * `tag_pattern` — see the CLI block for why loosening it is the safe direction. The gap
 * between them is real (`v1.2`, `v1.3.0-rc.1`, `v2024.01` all match the glob and none the
 * pattern), and lands here: not a first release, yet no baseline to bump from.
 *
 * @returns {string} A refusal reason, plain-language and actionable.
 */
function unreadableTagsReason() {
	return (
		'this repo already has version tags, but none of them match the `vX.Y.Z` form the ' +
		'release tooling reads (three numbers, like `v1.2.3`), so there is no baseline to ' +
		'work the next version out from. Put a full three-number tag on the commit you last ' +
		'released and push it — `git tag -a v1.2.0 <commit> -m v1.2.0 && git push origin ' +
		'v1.2.0` — then run `npm run release` again. If your tags already look like that, it ' +
		'is the release tool itself that failed to start: run `npm install` and try again.'
	);
}

/**
 * Explain that the previous run got as far as committing and tagging, and then failed to push.
 *
 * The state is easy to reach — a ruleset on `main` refuses a commit that carries no check
 * runs — and impossible to guess at from the other refusals: `package.json` already holds
 * the new version, so the next run computes no bump and would otherwise be told, with total
 * confidence, that there is "nothing to release". Worse on a first release, where the
 * seeding path skips that comparison entirely and a re-run prepends a SECOND `## [0.1.0]`
 * section to CHANGELOG.md before dying inside `npm version`.
 *
 * The undo is left to the invoker on purpose: `git reset --hard` throws work away, and this
 * script has no business doing that on someone's behalf. The commands here are the same ones
 * the recovery recipe in `DEPLOY.md` prints — keep the two identical.
 *
 * @param {string} version The version already committed, bare (`1.4.0`).
 * @param {string} defaultBranch The branch the release was meant to land on.
 * @returns {string} A refusal reason, plain-language and actionable.
 */
function unpushedReleaseReason(version, defaultBranch) {
	return (
		`v${version} was already prepared here and never reached the remote: \`HEAD\` is its ` +
		`\`chore(release): v${version}\` commit, \`package.json\` is already at ${version}, and ` +
		`none of it is on \`origin/${defaultBranch}\` — which is what a push refused by a branch ` +
		'ruleset leaves behind. Re-running from here would write a second changelog section for ' +
		'the same version, so nothing has been changed. Undo the half-finished release and start ' +
		`over: \`git fetch origin && git reset --hard origin/${defaultBranch} && git tag -d ` +
		`v${version}\`, then run \`npm run release\` again. \`git reset --hard\` discards ` +
		'uncommitted changes, so stash anything you want to keep first.'
	);
}

/**
 * Thrown when a release is abandoned part-way for a reason the invoker can act on, as
 * opposed to a command failing. The CLI prints the message on its own instead of the
 * generic "release failed while running …", because the message IS the whole explanation.
 */
export class ReleaseRefusedError extends Error {
	/** @param {string} message A plain-language reason, safe to show a non-technical user. */
	constructor(message) {
		super(message);
		this.name = 'ReleaseRefusedError';
	}
}

/**
 * Whether git-cliff's `--strip all` output actually describes anything.
 *
 * `--strip all` strips the changelog's header and footer but NOT the body's own
 * `## [X.Y.Z] - DATE` line, so a release window whose commits are every one of them
 * skipped by `cliff.toml`'s parsers still prints that single line and exits 0 —
 * verified. Treat the heading alone as empty; a `### Group` line (three hashes, so it
 * does not match `^## `) or a `- ` bullet counts as content.
 *
 * @param {string} notes Raw stdout of the notes-capture command.
 * @returns {boolean}
 */
function hasReleaseNotes(notes) {
	return notes.split('\n').some((line) => line.trim() !== '' && !line.startsWith('## '));
}

/**
 * Drop a leading `v` so a tag-shaped version (`v1.3.2`) and a `package.json` version
 * (`1.3.2`) compare equal. `git-cliff --bumped-version` prints the prefixed form;
 * `package.json` never does.
 */
function stripV(version) {
	return version.replace(/^v/, '');
}

/**
 * Resolve the argv prefix that runs npm — as `node <npm-cli.js>`, never as `npm.cmd`.
 *
 * **Why this exists (Windows, load-bearing):** since the CVE-2024-27980 fix
 * (Node ≥18.20.2 / ≥20.12.2) `child_process.spawn`/`execFile` throw `EINVAL` for a
 * `.bat`/`.cmd` target unless `shell: true`, and `shell: true` would put the release
 * commit's message (spaces, parentheses, a colon) through `cmd.exe` quoting. npm's real
 * entry point is a plain JS file, so handing it to `process.execPath` sidesteps both: a
 * real `.exe` is spawned and every argument stays a separate argv element.
 *
 * `platform` is a parameter rather than a read of `process.platform` so the Windows
 * shape is testable from any host.
 *
 * @param {object} environment
 * @param {string} environment.execPath The running Node binary (`process.execPath`).
 * @param {(path: string) => boolean} environment.fileExists Existence probe, injected.
 * @param {string | undefined} environment.npmExecPath `process.env.npm_execpath` — set to
 *   npm's own `npm-cli.js` by `npm run`, and authoritative when present.
 * @param {NodeJS.Platform | string} environment.platform `process.platform`.
 * @returns {string[]} argv prefix, e.g. `[node, '…/npm-cli.js']`. Falls back to a bare
 *   `['npm']` when no shim is found — correct on POSIX (npm is on `PATH` and is a real
 *   executable); on Windows that fallback fails loudly at spawn time rather than
 *   silently, which is the honest outcome for an npm installed somewhere unrecognised.
 */
export function resolveNpmArgv({ execPath, fileExists, npmExecPath, platform }) {
	if (npmExecPath?.endsWith('.js')) return [execPath, npmExecPath];

	const nodeDir = dirname(execPath);
	// The two official layouts: Windows ships npm beside `node.exe`; every POSIX
	// distribution (the .pkg, nvm, fnm, Volta, Homebrew) puts it under `../lib`.
	const shim =
		platform === 'win32'
			? join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
			: join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

	return fileExists(shim) ? [execPath, shim] : ['npm'];
}

/**
 * Decide what a release run should do, as a list of commands rather than side effects.
 *
 * Pure: everything it needs is passed in, so the whole decision — including the exact
 * argv of every command — is asserted in tests without spawning anything.
 *
 * Both versions are normalized with {@link stripV} before comparison; without that the
 * "nothing to release" refusal would be dead code whenever git-cliff prefixes its
 * output. The returned `version` is always bare (`1.4.0`); the `v` is re-added per
 * command, since tags and the commit subject carry it but `npm version` must not.
 *
 * It refuses for six distinct reasons — dirty tree, wrong branch, a previous run's release
 * commit still sitting unpushed ({@link unpushedReleaseReason}), nothing releasable, tags
 * that {@link unreadableTagsReason} explains, and a `version` that is not three plain
 * numbers. **The last two are the contract's own guards, not restatements of what the CLI
 * happens to gather:** this function is the only thing between an unusable version string
 * and a `git tag -a v…` / `npm version …` argument, and callers other than the CLI (its
 * tests included) can hand it anything.
 *
 * @param {object} state
 * @param {string} state.bumpedVersion What git-cliff computed, `v`-prefixed or not. Empty
 *   means "no next version could be worked out", which the CLI produces in both of the
 *   cases where `--bumped-version` cannot answer: before the first matching tag exists
 *   (where it is not even attempted, and the empty value is then discarded by the
 *   first-release seeding) and when tags exist but none match `cliff.toml`'s
 *   `tag_pattern` (where it exits non-zero — a refusal, not a first release).
 * @param {number} [state.commitsSinceLastRelease] Commits between the last matching tag
 *   and `HEAD`, used only to word the "nothing releasable" refusal — a window can be full
 *   of `chore`/`build` commits and still bump nothing. Defaults to `0`.
 * @param {string} state.currentBranch The branch `HEAD` is on.
 * @param {string} state.currentVersion `package.json`'s version.
 * @param {string} state.defaultBranch The repo's default branch, resolved by the CLI.
 * @param {string[]} [state.gitCliffArgv] argv prefix that runs git-cliff, baked into the
 *   plan so the executor stays dumb. Defaults to a bare `['git-cliff']`; the CLI passes
 *   `[node, <git-cliff>/lib/cli/cli.js]` — an argv, not a path, because on Windows only
 *   `node <shim>.js` is spawnable without a shell (see {@link resolveNpmArgv}).
 * @param {string} [state.headSubject] Subject line of the `HEAD` commit, used together with
 *   `isHeadPushed` to spot a previous run that committed and tagged but failed to push.
 *   Defaults to `''`, which matches nothing.
 * @param {boolean} state.isDirty Whether the working tree has uncommitted changes.
 * @param {boolean} [state.isHeadPushed] Whether `origin/<defaultBranch>` already contains
 *   `HEAD`. Defaults to `true` — the value that keeps the unpushed-release guard quiet — so
 *   a caller that cannot answer never gets a refusal it did not ask for.
 * @param {boolean} state.matchingTagsExist Whether any `v[0-9]*` tag exists. `false`
 *   means this repo has never released, so the version is seeded at
 *   {@link FIRST_RELEASE_VERSION} instead of being bumped from inherited history. `true`
 *   says only that a version-shaped tag exists — NOT that git-cliff can bump from it; the
 *   glob is looser than its `tag_pattern` on purpose (see the CLI block).
 * @param {string[]} [state.npmArgv] argv prefix that runs npm. Defaults to a bare
 *   `['npm']`; the CLI passes what {@link resolveNpmArgv} found.
 * @returns {{ action: 'refuse', reason: string }
 *   | { action: 'release', version: string, commands: Array<{ argv: string[], captureStdout?: string, refuseIfEmpty?: string, stdinFrom?: string }> }}
 */
export function planRelease({
	bumpedVersion,
	commitsSinceLastRelease = 0,
	currentBranch,
	currentVersion,
	defaultBranch,
	gitCliffArgv = ['git-cliff'],
	headSubject = '',
	isDirty,
	isHeadPushed = true,
	matchingTagsExist,
	npmArgv = ['npm'],
}) {
	if (isDirty) {
		return { action: 'refuse', reason: 'the working tree has uncommitted changes' };
	}
	if (currentBranch !== defaultBranch) {
		return {
			action: 'refuse',
			reason: `the current branch is \`${currentBranch}\`, not the default branch \`${defaultBranch}\` — a release commit, tag and GitHub release must all land on \`${defaultBranch}\``,
		};
	}
	// BEFORE the two version comparisons below, because in this state both of them answer
	// wrongly: the bump has already been written to `package.json`, so a normal repo reports
	// "nothing to release" and a first release sails past the comparison entirely.
	//
	// Two facts, both observable without the network and both produced by this script's own
	// commands: `HEAD` is the `chore(release): vX.Y.Z` commit it writes, its version is the
	// one `npm version` already put in `package.json`, and the remote-tracking branch does
	// not contain it. A successful push moves `origin/<branch>` forward, so the third fact is
	// false the moment the release lands — that is what keeps this from firing after every
	// completed release. The local tag is not consulted: it adds no case these three miss,
	// and asking the remote about it would need a network round trip.
	const headReleaseVersion = RELEASE_COMMIT_SUBJECT_PATTERN.exec(headSubject)?.[1];
	if (!isHeadPushed && headReleaseVersion === stripV(currentVersion)) {
		return {
			action: 'refuse',
			reason: unpushedReleaseReason(headReleaseVersion, defaultBranch),
		};
	}
	if (stripV(bumpedVersion) === stripV(currentVersion)) {
		return { action: 'refuse', reason: nothingReleasableReason(commitsSinceLastRelease) };
	}
	// Tags exist, so this is not a first release — but nothing was computed to bump to.
	// The CLI reaches this by treating a failed `--bumped-version` as an empty string.
	if (matchingTagsExist && bumpedVersion.trim() === '') {
		return { action: 'refuse', reason: unreadableTagsReason() };
	}

	const version = matchingTagsExist ? stripV(bumpedVersion) : FIRST_RELEASE_VERSION;
	// Last gate before the version is spliced into a tag name, a commit subject and an
	// `npm version` argument. Nothing upstream guarantees its shape — today only
	// git-cliff's own exit code does, outside this module and outside its tests.
	if (!RELEASE_VERSION_PATTERN.test(version)) {
		return {
			action: 'refuse',
			reason:
				`the next version came back as \`${bumpedVersion}\`, which is not a plain ` +
				'three-number version like `1.2.3`, so it would make a tag no later release ' +
				"could bump from. Check `cliff.toml`'s `tag_pattern` against the repo's tags.",
		};
	}
	const tag = `v${version}`;

	return {
		action: 'release',
		commands: [
			// FIRST, and read-only: this is the only point at which the release can be
			// abandoned for having no content while nothing has been written yet. Moving
			// the `--prepend` above it would leave a bare heading in CHANGELOG.md on bail.
			{
				argv: [...gitCliffArgv, '--unreleased', '--tag', tag, '--strip', 'all'],
				captureStdout: 'notes',
				refuseIfEmpty:
					`${tag} would have an empty changelog and empty release notes: none of the ` +
					'commits since the last release are of a type that appears in the changelog ' +
					`(${RELEASABLE_TYPES}). Nothing has been changed. Commit a change with a ` +
					'message starting `feat:` or `fix:`, then run `npm run release` again.',
			},
			{ argv: [...gitCliffArgv, '--unreleased', '--tag', tag, '--prepend', 'CHANGELOG.md'] },
			// `npm version` (not `npm pkg set`) because it also updates the two version
			// fields in package-lock.json, which would otherwise go stale.
			{ argv: [...npmArgv, 'version', version, '--no-git-tag-version'] },
			// Staged explicitly, never `commit -am`: a release must not sweep up whatever
			// else happens to be modified.
			{ argv: ['git', 'add', 'CHANGELOG.md', 'package.json', 'package-lock.json'] },
			{ argv: ['git', 'commit', '-m', `chore(release): ${tag}`] },
			// ANNOTATED (`-a`) is load-bearing: `--follow-tags` ignores lightweight tags,
			// which would leave the tag local while `gh release create` mints its own at
			// the branch head.
			{ argv: ['git', 'tag', '-a', tag, '-m', tag] },
			// `--atomic` is load-bearing, not tidiness: verified against a live repo, a
			// ruleset that refuses the branch update still lets `--follow-tags` land the TAG,
			// publishing a `vX.Y.Z` that no remote branch contains — and the next release then
			// measures from it and finds nothing to release. `--atomic` makes the pair one
			// transaction: git reports `atomic transaction failed` and neither ref moves.
			{ argv: ['git', 'push', '--atomic', '--follow-tags'] },
			{ argv: ['gh', 'release', 'create', tag, '--notes-file', '-'], stdinFrom: 'notes' },
		],
		version,
	};
}

/**
 * Run a plan's commands in order, threading captured stdout between them.
 *
 * A command with `captureStdout: '<slot>'` stores what it printed under that slot; a
 * later command with `stdinFrom: '<slot>'` is run with that text on stdin. That is how
 * the release notes reach `gh release create` without a temp file. Only the slots a plan
 * actually declares exist — nothing is captured speculatively.
 *
 * A command may also declare `refuseIfEmpty: '<reason>'`: if its stdout turns out to hold
 * no release notes ({@link hasReleaseNotes} — a lone `## [X.Y.Z] - DATE` counts as none),
 * the run stops with a {@link ReleaseRefusedError} carrying that reason and **no further
 * command executes**. The plan puts the only such command first, so bailing there has
 * changed nothing on disk.
 *
 * @param {Array<{ argv: string[], captureStdout?: string, refuseIfEmpty?: string, stdinFrom?: string }>} commands
 * @param {(command: { argv: string[], stdin?: string }) => string} run Executor; returns
 *   the command's stdout. Injected so the orchestration is testable without spawning.
 * @throws {ReleaseRefusedError} When a `refuseIfEmpty` command produced no notes.
 * @returns {void}
 */
export function runReleaseCommands(commands, run) {
	/** @type {Record<string, string>} */
	const captured = {};

	for (const { argv, captureStdout, refuseIfEmpty, stdinFrom } of commands) {
		const stdout = run(stdinFrom ? { argv, stdin: captured[stdinFrom] } : { argv });
		if (refuseIfEmpty && !hasReleaseNotes(stdout)) throw new ReleaseRefusedError(refuseIfEmpty);
		if (captureStdout) captured[captureStdout] = stdout;
	}
}

// CLI entry point: `npm run release` (or `node scripts/release.mjs`). `repoRoot` is
// derived from this file's location, not `process.cwd()`. Importing the module (e.g.
// from tests) does NOT run this block.
if (import.meta.main) {
	const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

	// git-cliff's npm bin is a plain JS shim (`"bin": "lib/cli/cli.js"`) that spawns the
	// real platform binary, so run it as `node <shim>` rather than through
	// `node_modules/.bin`. That is right on every platform for one reason: on Windows the
	// `.bin` entry is `git-cliff.cmd`, and `execFileSync` refuses to spawn a `.cmd` at all
	// without `shell: true` (the CVE-2024-27980 fix). `import.meta.resolve` asks the
	// package where its CLI lives instead of hardcoding the path — and, unlike a bare
	// `git-cliff`, does not depend on npm having put `.bin` on PATH.
	const gitCliffArgv = [process.execPath, fileURLToPath(import.meta.resolve('git-cliff/cli'))];
	const npmArgv = resolveNpmArgv({
		execPath: process.execPath,
		fileExists: existsSync,
		npmExecPath: process.env.npm_execpath,
		platform: process.platform,
	});

	/**
	 * Spawn a command from the repo root and return its stdout. stderr is inherited so
	 * git/gh/git-cliff progress and errors reach the terminal as they happen; a non-zero
	 * exit throws, which aborts the release part-way rather than pressing on.
	 *
	 * `quiet` captures stderr instead of inheriting it, and is only ever set by
	 * {@link tryRun}: there a non-zero exit is an expected ANSWER, not a fault, so the
	 * command's complaint is noise the refusal message then restates in plain language.
	 * It matters most for `--bumped-version`, whose failure git-cliff's npm shim re-throws
	 * as a dozen lines of Node stack trace.
	 */
	const run = ({ argv, quiet, stdin }) => {
		const [command, ...args] = argv;
		return execFileSync(command, args, {
			cwd: repoRoot,
			encoding: 'utf8',
			input: stdin,
			stdio: ['pipe', 'pipe', quiet ? 'pipe' : 'inherit'],
		});
	};

	// Escape hatch for the one thing `tryRun` hides: a git-cliff that failed for a reason
	// other than unreadable tags (a corrupt `cliff.toml`, say) is otherwise reported as the
	// tags refusal, which sends the reader off fixing tags that were never the problem.
	// `Boolean(...)` rather than a presence check: shells that export `DEBUG=` or `DEBUG=0`
	// unconditionally would otherwise turn the passthrough on for everyone.
	const verbose = process.argv.includes('--verbose') || Boolean(process.env.DEBUG);

	/**
	 * As {@link run}, but silent and an empty string instead of a throw on failure. Under
	 * `--verbose` (or a non-empty `DEBUG`) the swallowed stderr is re-emitted, because a non-zero
	 * exit here is turned into a plain-language refusal that can only ever be a best guess
	 * at which of several causes it was.
	 */
	const tryRun = ({ argv }) => {
		try {
			return run({ argv, quiet: true });
		} catch (error) {
			if (verbose) {
				process.stderr.write(
					`\n> ${argv.join(' ')} failed:\n${error.stderr ?? error.message}\n`
				);
			}
			return '';
		}
	};

	/**
	 * Whether a command exits zero, for the ones that answer with an exit code rather than
	 * stdout (`git merge-base --is-ancestor`). Silent either way: a non-zero exit is the
	 * answer, not a fault.
	 */
	const runSucceeds = ({ argv }) => {
		try {
			run({ argv, quiet: true });
			return true;
		} catch {
			return false;
		}
	};

	const currentVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
	const isDirty = run({ argv: ['git', 'status', '--porcelain'] }).trim() !== '';
	const currentBranch = run({ argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] }).trim();
	// `origin/HEAD` is the cheap local answer and needs no network, but it is only set if
	// the clone came from `git clone` (or someone ran `git remote set-head`). Falling back
	// to `main` is deliberate: it is this template's default branch and the branch the
	// `main-required-checks` ruleset targets.
	const defaultBranch =
		tryRun({ argv: ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'] })
			.trim()
			.replace(/^origin\//, '') || 'main';
	const headSubject = run({ argv: ['git', 'log', '-1', '--pretty=%s'] }).trim();
	// "Does the remote branch already contain HEAD?" — asked of the remote-TRACKING ref, so
	// it costs no network and stays honest: a successful `git push` moves `origin/<branch>`
	// forward, and a refused one leaves it where it was. `--is-ancestor` answers with its
	// exit code, and also exits non-zero when `origin/<branch>` does not exist at all — a
	// branch that has never been pushed, which is likewise "not pushed".
	const isHeadPushed = runSucceeds({
		argv: ['git', 'merge-base', '--is-ancestor', 'HEAD', `origin/${defaultBranch}`],
	});
	// A git GLOB, anchored to the whole refname by git — deliberately not `cliff.toml`'s
	// `tag_pattern` regex, and deliberately LOOSER than it. The question here is "has this
	// repo ever released?", not "can git-cliff bump from a tag?": `v1.2`, `v1.3.0-rc.1` and
	// `v2024.01` match this glob and not the pattern, and answering `false` for them would
	// seed a v1.2 repo's next release at 0.1.0 — a silent version REGRESSION. Answering
	// `true` instead sends the gap to `planRelease`, which refuses and says how to fix the
	// tags. Tightening the glob (`v[0-9]*.[0-9]*.[0-9]*`) would close two of those three
	// cases and buy the regression; a glob cannot express the anchored pattern anyway.
	const matchingTagsExist = run({ argv: ['git', 'tag', '-l', 'v[0-9]*'] }).trim() !== '';
	// Commits reachable from HEAD but from no `v[0-9]*` tag — i.e. the release window.
	// Phrased as `--not --tags=<glob>` rather than `<lastTag>..HEAD` because it needs no
	// `git describe` and cannot fail when the repo has never been tagged.
	const commitsSinceLastRelease =
		Number(
			run({ argv: ['git', 'rev-list', '--count', 'HEAD', '--not', '--tags=v[0-9]*'] }).trim()
		) || 0;
	// Before the first matching tag, `--bumped-version` cannot succeed: it computes a
	// bare `0.1.0` and then rejects it against `tag_pattern` (`^v…`), exiting non-zero.
	// The value would be discarded by the first-release seeding anyway, so don't ask.
	// An empty string can never equal a `package.json` version, so the "nothing to
	// release" refusal stays out of the way.
	//
	// `tryRun`, because the same non-zero exit ALSO happens when tags exist but none match
	// `tag_pattern` (see the glob comment above). That is a state to refuse in plain
	// language, not to crash on: an empty string is how `planRelease` is told about it.
	const bumpedVersion = matchingTagsExist
		? tryRun({ argv: [...gitCliffArgv, '--bumped-version'] }).trim()
		: '';

	const plan = planRelease({
		bumpedVersion,
		commitsSinceLastRelease,
		currentBranch,
		currentVersion,
		defaultBranch,
		gitCliffArgv,
		headSubject,
		isDirty,
		isHeadPushed,
		matchingTagsExist,
		npmArgv,
	});

	if (plan.action === 'refuse') {
		process.stderr.write(`Not releasing: ${plan.reason}\n`);
		process.exitCode = 1;
	} else {
		process.stdout.write(`Releasing v${plan.version} (from ${currentVersion})\n`);
		let lastCommand = '';
		try {
			runReleaseCommands(plan.commands, (command) => {
				lastCommand = command.argv.join(' ');
				process.stdout.write(`\n> ${lastCommand}\n`);
				const stdout = run(command);
				process.stdout.write(stdout);
				return stdout;
			});
			process.stdout.write(`\nReleased v${plan.version}\n`);
		} catch (error) {
			// A refusal is not a failure: the run stopped on purpose, before anything was
			// written, and its message is the entire explanation. Everything else is a
			// command that died — it already explained itself on the inherited stderr, so a
			// Node stack trace on top helps nobody. Name the step that stopped and leave the
			// repo exactly as it is: a half-finished release is recoverable by hand, and
			// guessing at an undo is riskier than stopping.
			process.stderr.write(
				error instanceof ReleaseRefusedError
					? `\nNot releasing: ${error.message}\n`
					: `\nRelease failed while running: ${lastCommand}\n`
			);
			process.exitCode = 1;
		}
	}
}
