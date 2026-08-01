import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Applies the GitHub-side settings this template depends on: the `main-required-checks`
 * branch ruleset (the three CI jobs that must be green before `main` moves) and the two
 * repository merge settings that keep the publish loop tidy.
 *
 * Runs in two modes. `auto` is the quiet one `bootstrap.sh` calls: anything missing —
 * no `gh`, not signed in, not an admin — is a one-line skip and exit 0, because setup
 * must never fail on an optional step. `explicit` (`npm run setup:github`) is the one the
 * user asked for, so the same states are loud failures with a fix in the message. The
 * contrast covers a change GitHub *refuses* too, not just an unmet precondition — see
 * {@link runSetupCommands}, which is where a private repo on the Free plan lands.
 *
 * Shape mirrors `release.mjs`: a pure decision core ({@link planGithubSetup}) that emits
 * `{ argv, stdin }` commands, an executor over an injected runner that turns their outcome
 * into lines and an exit code ({@link runSetupCommands}), and a thin `import.meta.main` CLI
 * that does all the impure gathering, spawning and writing. Progress is written with
 * `process.stdout.write`; never `console.log` (`no-console`).
 */

/** The ruleset this script owns, matched by name so re-runs update rather than duplicate. */
export const RULESET_NAME = 'main-required-checks';

/**
 * The `ci.yml` job display names that become required status checks, byte-exact.
 *
 * **These strings are a contract with `.github/workflows/ci.yml`** (which carries a
 * matching comment above each job). GitHub accepts a required check naming a context no
 * job produces, and every pull request then waits on it forever — so a typo here does not
 * fail loudly, it blocks the repo. {@link planGithubSetup} refuses to emit the ruleset
 * unless all three names are actually present in the workflow, and the test suite couples
 * them to the live file.
 */
export const GATE_CHECK_NAMES = ['Build & test', 'Secret scan', 'Docker smoke'];

/**
 * Whether an `origin` URL points at GitHub, tested by plain substring on purpose.
 *
 * **Do not tighten this to a boundary-anchored host match.** SSH config aliases are
 * ordinary in multi-account setups — this very repo's origin is
 * `git@github.com-personal:semi-sentient/vibe-starter.git` — and `github\.com[:/]`, or any
 * URL parse with host equality, rejects them. The failure would be silent (a skip in
 * `auto` mode) on a repo that is on GitHub. The permission rung below is what actually
 * gates the mutation; this rung only answers "is there anything GitHub-shaped here at
 * all", so being generous costs nothing.
 *
 * @param {unknown} originUrl Output of `git remote get-url origin`, or `null` when the
 *   command failed (no remote, not a git repo).
 * @returns {boolean}
 */
export function isGithubOrigin(originUrl) {
	return typeof originUrl === 'string' && originUrl.includes('github.com');
}

/**
 * The ordered precondition ladder, stated once.
 *
 * Each rung knows how to test itself against a (possibly partial) gathered state and how
 * to explain itself. {@link planGithubSetup} walks all of them; `gatherSetupState` walks
 * them alongside its gathering so it can stop collecting at the first unmet one — which
 * is why `met` must tolerate a state whose later keys are still at their defaults.
 *
 * @type {Record<string, { met: (state: object) => boolean, reason: (state: object) => string }>}
 */
const PRECONDITIONS = {
	ghInstalled: {
		met: ({ ghInstalled }) => ghInstalled === true,
		reason: () =>
			'the GitHub command-line tool (`gh`) is not installed, so the GitHub settings for ' +
			'this project cannot be read or changed. Install it from https://cli.github.com ' +
			'and run `npm run setup:github`.',
	},
	ghAuthed: {
		met: ({ ghAuthed }) => ghAuthed === true,
		reason: () =>
			'the GitHub command-line tool (`gh`) is not signed in to GitHub. Run ' +
			'`gh auth login`, then run `npm run setup:github`.',
	},
	originIsGithub: {
		met: ({ originIsGithub }) => originIsGithub === true,
		reason: () =>
			'the `origin` remote does not point at GitHub, so there are no GitHub settings to ' +
			'apply. Point `origin` at a GitHub repository, then run `npm run setup:github`.',
	},
	viewerIsAdmin: {
		met: ({ viewerPermission }) => viewerPermission === 'ADMIN',
		reason: ({ viewerPermission }) =>
			'changing branch protection and merge settings needs admin access to this ' +
			`repository, and your access is \`${viewerPermission ?? 'unknown'}\`. Ask someone ` +
			'who administers the repository to run `npm run setup:github`.',
	},
	ciJobNames: {
		met: ({ ciJobNames }) => missingGateChecks(ciJobNames).length === 0,
		reason: ({ ciJobNames }) => {
			const missing = missingGateChecks(ciJobNames)
				.map((name) => `\`${name}\``)
				.join(', ');
			return (
				`${CI_WORKFLOW_PATH} no longer defines a job named ${missing}. Required checks ` +
				'are named after those jobs, and GitHub will happily wait forever for a check ' +
				'that no job produces — which blocks every pull request. Restore the job ' +
				`name(s) in ${CI_WORKFLOW_PATH}, then run \`npm run setup:github\`.`
			);
		},
	},
};

/** The rungs in the order they are tested — earlier ones gate the commands later ones need. */
const PRECONDITION_ORDER = Object.keys(PRECONDITIONS);

/** Gate names the workflow does not define. Empty means the ruleset is safe to apply. */
function missingGateChecks(ciJobNames) {
	const names = Array.isArray(ciJobNames) ? ciJobNames : [];
	return GATE_CHECK_NAMES.filter((gate) => !names.includes(gate));
}

/** Where the job display names come from, relative to the repo root. */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

/**
 * Job display names out of a GitHub Actions workflow, without a YAML parser.
 *
 * `scripts/**` is dependency-free by design, and the one thing needed here is cheap to
 * read off the text: in this Prettier-formatted workflow a job-level `name:` key sits at
 * exactly eight spaces of indent, while step names are deeper and carry a `- ` prefix.
 * Comment lines at the same indent start with `#` and cannot match.
 *
 * Over-matching is harmless — the templated `Cross-platform build (${{ matrix.os }})`
 * comes back too, and the caller only ever asks whether the gate names are a SUBSET of
 * this list. Under-matching is what costs: a name that fails to appear looks like a
 * renamed job and stops the ruleset from being applied. Hence the `\r` strip, which is
 * defence in depth rather than a live need: this repository's `.gitattributes` pins
 * `*.yml` to `eol=lf`, so even a Windows checkout of the template gets LF here. A
 * downstream repository owns its own `.gitattributes`, and without that pin a clone with
 * `core.autocrlf=true` yields `Build & test\r` and reads every gate as renamed.
 *
 * @param {string} workflowYaml Contents of `.github/workflows/ci.yml`.
 * @returns {string[]} Display names, in file order.
 */
export function extractCiJobNames(workflowYaml) {
	return workflowYaml.split('\n').flatMap((line) => {
		const match = /^ {8}name: (.+)$/.exec(line.replace(/\r$/, ''));
		return match ? [match[1]] : [];
	});
}

/**
 * A `gh api` invocation that sends its JSON body on stdin.
 *
 * `--input -` rather than `-f`/`-F`: those flatten to string fields and cannot express the
 * nested arrays this ruleset needs. `{owner}` and `{repo}` are gh's own placeholders,
 * filled from the repository of the working directory — which is why nothing here has to
 * gather the repo slug.
 */
function ghApiArgv(method, path) {
	return ['gh', 'api', '--method', method, path, '--input', '-'];
}

/**
 * The one ruleset this script installs: the three CI gates must pass before the default
 * branch moves, and nothing else.
 *
 * Deliberately absent, each a decision recorded in the plan rather than an oversight:
 * no `pull_request` rule (no forced review, no forced PR — a solo maintainer can still
 * push to `main`), and `strict_required_status_checks_policy: false` (a branch need not be
 * rebased onto the tip before merging, which would serialise every merge).
 *
 * `bypass_actors` is omitted: the REST API documents it as optional on both create and
 * update, and omitting it is how "nobody bypasses these checks" is expressed. See the
 * phase handoff for what could NOT be confirmed without a write — whether an update that
 * omits the key clears bypass actors somebody added by hand.
 */
function requiredChecksRuleset() {
	return {
		conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
		enforcement: 'active',
		name: RULESET_NAME,
		rules: [
			{
				parameters: {
					required_status_checks: GATE_CHECK_NAMES.map((context) => ({ context })),
					strict_required_status_checks_policy: false,
				},
				type: 'required_status_checks',
			},
		],
		target: 'branch',
	};
}

/**
 * Read one string field out of a command's JSON stdout, or `null` if anything is off.
 *
 * `gh` answering 0 with something that is not the JSON we asked for is a real state (a
 * broken alias, an extension printing a banner) and must read as "unknown", never throw:
 * every caller here is on the path `npm run setup` takes.
 */
function parseJsonField(stdout, field) {
	try {
		const value = JSON.parse(stdout)[field];
		return typeof value === 'string' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Parse the `[{id, name}]` list `gh api … --jq` prints, or `[]` if anything is off.
 *
 * Falling back to "no rulesets" makes a re-run POST a duplicate instead of updating —
 * visible and fixable. The alternative, guessing at an id, would overwrite a ruleset this
 * script does not own. An entry missing either field is dropped for the same reason: the
 * id is spliced straight into the update path, so `undefined` there is a request nobody
 * intended.
 */
function parseRulesets(stdout) {
	try {
		const rulesets = JSON.parse(stdout);
		return Array.isArray(rulesets)
			? rulesets.filter(
					(entry) => typeof entry?.id === 'number' && typeof entry?.name === 'string'
				)
			: [];
	} catch {
		return [];
	}
}

/**
 * Which mode the CLI was invoked in. Only the literal `--explicit` opts into failing;
 * anything else — including a typo — gets the quiet, exit-0 behaviour, because this runs
 * inside `npm run setup` where an optional step must never break the run.
 *
 * @param {string[]} argv Arguments after the script name (`process.argv.slice(2)`).
 * @returns {'auto' | 'explicit'}
 */
export function parseMode(argv) {
	return argv.includes('--explicit') ? 'explicit' : 'auto';
}

/**
 * Collect everything {@link planGithubSetup} needs, stopping at the first unmet rung.
 *
 * The ladder is walked twice on purpose: here, interleaved with the gathering so nothing
 * pointless is run, and again inside the pure decision function, which re-derives the
 * verdict from whatever came back. Only the *rung definitions* are shared, so the order
 * and the reasons still have exactly one home.
 *
 * Short-circuiting is not an optimisation. An unauthenticated `gh` fails every later
 * command, and a non-admin is refused the rulesets read with a 403 — so pressing on turns
 * one clear answer into a pile of errors.
 *
 * @param {object} inputs
 * @param {'auto' | 'explicit'} inputs.mode From {@link parseMode}.
 * @param {(path: string) => string | null} inputs.readFile Repo-root-relative reader;
 *   `null` when the file cannot be read. A second injection seam, mocked like the runner.
 * @param {(command: { argv: string[] }) => string | null} inputs.run Executor returning
 *   stdout, or **`null` on any non-zero exit or spawn failure — it must never throw**.
 *   A failure here is an ANSWER (that rung is unmet), so the real implementation also has
 *   to keep the command's own stderr off the terminal; otherwise `npm run setup` prints
 *   gh's complaints around its one skip line.
 * @returns {object} The input {@link planGithubSetup} expects; keys past the failed rung
 *   keep their falsy defaults.
 */
export function gatherSetupState({ mode, readFile, run }) {
	const state = {
		ciJobNames: [],
		existingRulesets: [],
		ghAuthed: false,
		ghInstalled: false,
		mode,
		originIsGithub: false,
		viewerPermission: null,
	};

	state.ghInstalled = run({ argv: ['gh', '--version'] }) !== null;
	if (!PRECONDITIONS.ghInstalled.met(state)) return state;

	state.ghAuthed = run({ argv: ['gh', 'auth', 'status'] }) !== null;
	if (!PRECONDITIONS.ghAuthed.met(state)) return state;

	state.originIsGithub = isGithubOrigin(run({ argv: ['git', 'remote', 'get-url', 'origin'] }));
	if (!PRECONDITIONS.originIsGithub.met(state)) return state;

	state.viewerPermission = parseJsonField(
		run({ argv: ['gh', 'repo', 'view', '--json', 'viewerPermission'] }),
		'viewerPermission'
	);
	if (!PRECONDITIONS.viewerIsAdmin.met(state)) return state;

	const workflow = readFile(CI_WORKFLOW_PATH);
	state.ciJobNames = workflow === null ? [] : extractCiJobNames(workflow);
	if (!PRECONDITIONS.ciJobNames.met(state)) return state;

	// `includes_parents=false` is load-bearing, not tidiness. The endpoint defaults to
	// TRUE and folds in org- and enterprise-level rulesets, which this script can neither
	// own nor update: one of those named `main-required-checks` would match the upsert
	// below, and its id would be spliced into the REPO-scoped update path — a 404 that
	// fails the run and prints gh's complaint in the middle of `npm run setup`.
	//
	// Pagination is deliberately NOT handled, but the page is asked for at its maximum.
	// `per_page=100` costs nothing and raises the default cap of 30 by 3.3×; `--paginate`
	// would make things WORSE rather than better, because combined with `--jq` gh prints one
	// JSON array PER PAGE, which `JSON.parse` rejects outright — every repo with a second
	// page would then resolve to `[]`, not merely those whose ruleset sits past page one.
	// A repository with more than 100 of its own rulesets is not a real shape, and `[]` is a
	// recoverable answer even then: {@link parseRulesets} explains why a duplicate POST is
	// the right fallback and a guessed id is not.
	state.existingRulesets = parseRulesets(
		run({
			argv: [
				'gh',
				'api',
				'/repos/{owner}/{repo}/rulesets?includes_parents=false&per_page=100',
				'--jq',
				'[.[] | {id, name}]',
			],
		})
	);
	return state;
}

/**
 * Decide what a `setup-github` run should do, as a list of commands rather than side
 * effects.
 *
 * Pure: everything it needs is passed in, so the whole decision — including the exact
 * argv and request body of every mutation — is asserted in tests without touching
 * GitHub.
 *
 * @param {object} state
 * @param {string[]} state.ciJobNames Job display names scanned out of the CI workflow.
 * @param {Array<{ id: number, name: string }>} state.existingRulesets The repo's rulesets;
 *   the `id` is what makes a re-run an update instead of a duplicate.
 * @param {boolean} state.ghAuthed Whether `gh` is signed in.
 * @param {boolean} state.ghInstalled Whether `gh` is on the PATH.
 * @param {'auto' | 'explicit'} state.mode `auto` skips on an unmet precondition, `explicit`
 *   fails. Anything other than `'explicit'` is treated as `auto` — the quiet, exit-0
 *   behaviour is the safe default for a step wired into `npm run setup`.
 * @param {boolean} state.originIsGithub See {@link isGithubOrigin}.
 * @param {string | null} state.viewerPermission `gh repo view --json viewerPermission`.
 *   Only `ADMIN` can change these settings; `MAINTAIN` deliberately cannot.
 * @returns {{ action: 'skip' | 'fail', reason: string }
 *   | { action: 'apply', reason: string, commands: Array<{ argv: string[], describe: string, stdin: string, subject: string }> }}
 *   A command's `describe` is the plain line printed once it has succeeded; its `subject`
 *   is the same change as a noun phrase, for the line printed when GitHub refuses it. Both
 *   live here rather than in the CLI so the wording can be asserted.
 */
export function planGithubSetup(state) {
	for (const rung of PRECONDITION_ORDER) {
		if (!PRECONDITIONS[rung].met(state)) {
			return {
				action: state.mode === 'explicit' ? 'fail' : 'skip',
				reason: PRECONDITIONS[rung].reason(state),
			};
		}
	}

	const existing = state.existingRulesets.find((ruleset) => ruleset.name === RULESET_NAME);
	const rulesetPath = existing
		? `/repos/{owner}/{repo}/rulesets/${existing.id}`
		: '/repos/{owner}/{repo}/rulesets';

	return {
		action: 'apply',
		commands: [
			{
				argv: ghApiArgv(existing ? 'PUT' : 'POST', rulesetPath),
				describe: existing
					? `Updated the required checks on the default branch: ${GATE_CHECK_NAMES.join(', ')}.`
					: `Required checks are now enforced on the default branch: ${GATE_CHECK_NAMES.join(', ')}.`,
				stdin: JSON.stringify(requiredChecksRuleset()),
				subject: 'the required checks on the default branch',
			},
			{
				argv: ghApiArgv('PATCH', '/repos/{owner}/{repo}'),
				describe:
					'Merged branches are now deleted automatically, and auto-merge is available ' +
					'on pull requests.',
				stdin: JSON.stringify({ allow_auto_merge: true, delete_branch_on_merge: true }),
				subject: 'the repository merge settings',
			},
		],
		reason: existing
			? `updating the \`${RULESET_NAME}\` ruleset and the repository merge settings`
			: `creating the \`${RULESET_NAME}\` ruleset and the repository merge settings`,
	};
}

/**
 * Run the commands {@link planGithubSetup} emitted and say what happened, as text rather
 * than side effects — so the mode contrast below is asserted without spawning anything.
 *
 * **A refusal does not stop the run.** Every command is an independent, idempotent write to
 * a different resource, so pressing on applies whatever GitHub will accept and reports the
 * rest; stopping at the first failure would throw away changes that were never in doubt.
 * The concrete case: repository rulesets are a paid feature on private repositories, so on
 * the GitHub Free plan the ruleset write 403s while the merge-settings PATCH — which every
 * plan allows — would have succeeded. Ordering is left as the plan states it (the ruleset
 * is the headline change and is reported first); with failures no longer stopping the loop,
 * reordering would buy nothing. Nothing is half-applied in a confusing way: each command
 * that succeeds prints its own line, each that fails is named, and re-running finishes the
 * job.
 *
 * **The mode decides how loud a refusal is, and it is the whole point of having modes.**
 * `auto` is inside `npm run setup`: one calm `Skipping GitHub settings: …` line naming what
 * GitHub would not do, exit 0, and gh's own words withheld — a wall of red mid-bootstrap is
 * a product failure for the non-technical user this template is for. `explicit` is the
 * command they typed: gh's error verbatim, the failing command named, and a non-zero exit.
 *
 * @param {object} inputs
 * @param {Array<{ argv: string[], describe: string, stdin: string, subject: string }>}
 *   inputs.commands From {@link planGithubSetup}.
 * @param {'auto' | 'explicit'} inputs.mode Anything other than `'explicit'` is `auto`, as
 *   everywhere else in this module.
 * @param {(command: { argv: string[], stdin: string }) => { ok: boolean, stderr: string }}
 *   inputs.run Apply-side executor. **A different contract from the gathering runner**: a
 *   failure here is not an answer, so the command's own stderr is captured and handed back
 *   rather than dropped — `explicit` mode needs it. It must never throw.
 * @returns {{ exitCode: 0 | 1, stderr: string[], stdout: string[] }} Lines to write, each
 *   without its trailing newline. `stdout` always begins with one line per applied change.
 */
export function runSetupCommands({ commands, mode, run }) {
	const applied = [];
	const failures = [];

	for (const command of commands) {
		const { ok, stderr } = run({ argv: command.argv, stdin: command.stdin });
		if (ok) applied.push(command.describe);
		else failures.push({ command, stderr });
	}

	if (failures.length === 0) return { exitCode: 0, stderr: [], stdout: applied };

	const subjects = failures.map(({ command }) => command.subject).join(' and ');

	if (mode === 'explicit') {
		return {
			exitCode: 1,
			stderr: failures.flatMap(({ command, stderr }) => [
				...(stderr.trim() === '' ? [] : [stderr.trimEnd()]),
				`Cannot apply GitHub settings: GitHub would not apply ${command.subject}. The ` +
					`command that failed was \`${command.argv.join(' ')}\`.`,
			]),
			stdout: applied,
		};
	}

	return {
		exitCode: 0,
		stderr: [],
		stdout: [
			...applied,
			`Skipping GitHub settings: GitHub would not apply ${subjects}. Run ` +
				'`npm run setup:github` to see what GitHub said.',
		],
	};
}

// CLI entry point: `npm run setup:github` (explicit), or the quiet step `bootstrap.sh`
// runs (auto). `repoRoot` is derived from this file's location, not `process.cwd()`.
// Importing the module (e.g. from tests) does NOT run this block.
if (import.meta.main) {
	const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
	const mode = parseMode(process.argv.slice(2));

	/**
	 * Gathering executor: stdout on success, `null` on any failure, and SILENT either way.
	 *
	 * stderr is piped rather than inherited because a non-zero exit here is an expected
	 * answer, not a fault — `gh auth status` is loud about not being signed in, and in
	 * `auto` mode that noise would wrap the one skip line `npm run setup` is meant to
	 * print. `gh` and `git` are real executables on every platform, so nothing here is at
	 * risk of the `.cmd` spawn restriction that shaped `release.mjs`.
	 */
	const tryRun = ({ argv }) => {
		const [command, ...args] = argv;
		try {
			return execFileSync(command, args, {
				cwd: repoRoot,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe'],
			});
		} catch {
			return null;
		}
	};

	const state = gatherSetupState({
		mode,
		readFile: (path) => {
			try {
				return readFileSync(join(repoRoot, path), 'utf8');
			} catch {
				return null;
			}
		},
		run: tryRun,
	});
	const plan = planGithubSetup(state);

	if (plan.action === 'skip') {
		// One line, on stdout, exit 0: this is an optional step inside `npm run setup`.
		process.stdout.write(`Skipping GitHub settings: ${plan.reason}\n`);
	} else if (plan.action === 'fail') {
		process.stderr.write(`Cannot apply GitHub settings: ${plan.reason}\n`);
		process.exitCode = 1;
	} else {
		const report = runSetupCommands({
			commands: plan.commands,
			mode,
			/**
			 * Applying executor. stdout is discarded: it is the API's JSON echo of the object
			 * just written, which tells the user nothing. stderr is CAPTURED rather than
			 * inherited — gh's complaint must not reach the terminal before
			 * {@link runSetupCommands} has decided, from the mode, whether the user asked for
			 * it. Handing the text back rather than dropping it is what keeps `explicit` loud.
			 */
			run: ({ argv, stdin }) => {
				const [command, ...args] = argv;
				try {
					execFileSync(command, args, {
						cwd: repoRoot,
						encoding: 'utf8',
						input: stdin,
						stdio: ['pipe', 'pipe', 'pipe'],
					});
					return { ok: true, stderr: '' };
				} catch (error) {
					// `encoding: 'utf8'` makes `error.stderr` a string on a non-zero exit; a
					// spawn failure has none, so fall back to Node's own message.
					return { ok: false, stderr: String(error?.stderr || error?.message || '') };
				}
			},
		});

		for (const line of report.stdout) process.stdout.write(`${line}\n`);
		for (const line of report.stderr) process.stderr.write(`${line}\n`);
		if (report.exitCode !== 0) process.exitCode = report.exitCode;
	}
}
