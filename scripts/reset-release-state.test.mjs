import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planRelease, RELEASABLE_TYPES } from './release.mjs';
import { resetReleaseState } from './reset-release-state.mjs';

// This file lives in `<repoRoot>/scripts/`, so the repo root is its parent. Derived
// from the module URL, never `process.cwd()` — the suite runs its fixtures out of
// tmpdirs, so a relative path would resolve against the wrong tree.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Each fixture is seeded from KNOWN, LITERAL pre-reset content (name `vibe-starter`,
// version `1.1.0`, a full CHANGELOG, a `# vibe-starter` README) rather than by copying
// the live repo's own state files. That makes the suite self-contained: it asserts the
// exact same outcome in this template AND in any repo generated from it that has
// already run `npm run setup` (where those live files are already reset). The literals
// below only need the fields the assertions touch.
const PRE_RESET_PACKAGE = {
	name: 'vibe-starter',
	version: '1.1.0',
	description: 'An opinionated, MIT-licensed full-stack TypeScript starter template.',
	license: 'MIT',
	private: true,
	engines: { node: '24.x' },
	scripts: { build: 'npm run build:web && npm run build:server', test: 'vitest run' },
	dependencies: { hono: '^4.6.0' },
	devDependencies: { vitest: '^4.0.0' },
};

// A SYNTHETIC stand-in for everything above the first `## ` heading, trailing blank
// line included — deliberately shorter than the real intro so these cases pin the
// TRANSFORMATION (truncate at the first entry, keep exactly one trailing blank line)
// independently of the template's current prose. The real file's bytes — which are
// what the release tooling configures as its changelog header — are pinned separately
// by the `template's own CHANGELOG header` case below.
const PRE_RESET_CHANGELOG_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;

const PRE_RESET_CHANGELOG = `${PRE_RESET_CHANGELOG_HEADER}## [1.1.0] - 2026-01-01

### Added

- A real feature.
`;

// A pre-reset README: the `# vibe-starter` title, a description line, and the
// upstream CHANGELOG link the README intentionally keeps pointing at the template.
const UPSTREAM_CHANGELOG_LINK =
	'[CHANGELOG](https://github.com/semi-sentient/vibe-starter/blob/main/CHANGELOG.md)';
const PRE_RESET_README = `# vibe-starter

An opinionated, MIT-licensed full-stack TypeScript starter template.

This is a snapshot, not a dependency — skim the ${UPSTREAM_CHANGELOG_LINK} to port upstream changes.
`;

/** A throwaway repo seeded with the template's pre-reset release-state files. */
let fixtureRoot;

beforeEach(() => {
	fixtureRoot = mkdtempSync(join(tmpdir(), 'reset-release-state-'));
	writeFileSync(
		join(fixtureRoot, 'package.json'),
		JSON.stringify(PRE_RESET_PACKAGE, null, '\t') + '\n'
	);
	writeFileSync(join(fixtureRoot, 'CHANGELOG.md'), PRE_RESET_CHANGELOG);
	writeFileSync(join(fixtureRoot, 'README.md'), PRE_RESET_README);
});

afterEach(() => {
	rmSync(fixtureRoot, { force: true, recursive: true });
});

/** Read + parse a JSON file from the fixture root. */
function readJson(file) {
	return JSON.parse(readFileSync(join(fixtureRoot, file), 'utf8'));
}

/**
 * Everything above the first `## ` heading, INCLUDING the blank line that separates
 * it — i.e. the bytes `resetChangelog()` must emit, and the bytes the release tooling
 * configures as its changelog header.
 *
 * No `## ` heading at all means the file is ALREADY the stub, so the whole file is
 * the header block. That is not a broken CHANGELOG — it is the normal state of every
 * repo generated from this template, where `npm run setup` has already truncated it.
 * This file ships downstream and runs on every commit there (pre-commit → `npm test`),
 * so that case must resolve to an expected value, never fail.
 */
function headerBlockOf(changelog) {
	const firstEntry = changelog.indexOf('\n## ');
	return firstEntry === -1 ? changelog : changelog.slice(0, firstEntry + 1);
}

/**
 * True only in the template repo itself.
 *
 * The `itInTemplate` cases read the LIVE `CHANGELOG.md` / `cliff.toml`, and downstream
 * both files belong to the user: hand-editing the intro (or deleting either file) would
 * redden their next commit — this suite gates it via pre-commit →
 * `npm run build:validate` → `npm test` — with a failure message about `cliff.toml` that
 * means nothing in their repo. Every OTHER case here is self-contained and still runs
 * everywhere.
 */
function isTemplateRepo() {
	try {
		return (
			JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).name ===
			'vibe-starter'
		);
	} catch {
		return false;
	}
}

/** Runs only in the template repo — see {@link isTemplateRepo}. */
const itInTemplate = it.skipIf(!isTemplateRepo());

/**
 * Decode `[changelog] header` out of `cliff.toml` without a TOML parser (`scripts/` is
 * dependency-free, and Node has no built-in TOML support).
 *
 * Exact rather than approximate because the header is written as a TOML *literal*
 * multi-line string (`'''`): literal strings perform NO escape processing, so the value
 * is precisely the bytes between the delimiters, minus the newline that immediately
 * follows the opening `'''`. Both of those rules are applied below, which is why this
 * asserts on the DECODED string and not on raw TOML source.
 *
 * **Switching the header to a basic string (`"""`) would make this decoder wrong** —
 * those process backslash escapes — hence the loud throw when the form is not found.
 */
function cliffChangelogHeader(cliffToml) {
	const match = /^header = '''\n([\s\S]*?)'''$/m.exec(cliffToml);
	if (!match) {
		throw new Error(
			"cliff.toml's `[changelog] header` is no longer a `'''`-delimited literal " +
				'string; this reader only handles that form (see its doc comment).'
		);
	}
	return match[1];
}

/**
 * Decode the conventional-commit types `cliff.toml` MAPS to a changelog section, in file
 * order — the catch-all (`{ message = ".*", skip = true }`) and any other skipping entry
 * excluded, since a skipped type is precisely one that cannot produce a release.
 *
 * Same no-TOML-parser discipline as {@link cliffChangelogHeader}, and the same loudness:
 * every entry must be one of the two forms this reader understands, or it throws rather
 * than quietly dropping a mapping and comparing a shorter list.
 */
function cliffMappedCommitTypes(cliffToml) {
	const block = /^commit_parsers = \[\n([\s\S]*?)^\]$/m.exec(cliffToml);
	if (!block) {
		throw new Error(
			"cliff.toml's `[git] commit_parsers` is no longer a `[`-to-`]` block of one " +
				'entry per line; this reader only handles that form (see its doc comment).'
		);
	}

	const types = [];
	for (const line of block[1].split('\n').filter((entry) => entry.trim() !== '')) {
		const fields = /^\t\{ (.+) \},$/.exec(line);
		if (!fields) throw new Error(`Unreadable cliff.toml commit_parsers entry: ${line}`);
		// A skipping entry is not a releasable type, whatever else it says.
		if (/(^|[^\w])skip = true([^\w]|$)/.test(fields[1])) continue;

		const mapping = /^message = "\^([a-z]+)", group = "[A-Za-z]+"$/.exec(fields[1]);
		if (!mapping) {
			throw new Error(
				`cliff.toml commit_parsers entry is neither a \`^<type>\` → group mapping nor ` +
					`a skip, so this reader cannot say whether it is releasable: ${line}`
			);
		}
		types.push(mapping[1]);
	}
	return types;
}

/**
 * Decode `[git] tag_pattern` out of `cliff.toml`, un-escaping the TOML basic string.
 *
 * Basic strings (`"…"`) DO process escapes, so the raw source `"^v[0-9]+\\.…"` denotes the
 * value `^v[0-9]+\.…`. Only `\\` is decoded — anything else throws, because a silently
 * mis-decoded pattern would make the assertion below test a regex that is not the one
 * git-cliff uses.
 */
function cliffTagPattern(cliffToml) {
	const match = /^tag_pattern = "(.*)"$/m.exec(cliffToml);
	if (!match) {
		throw new Error(
			"cliff.toml's `[git] tag_pattern` is no longer a single-line basic string; " +
				'this reader only handles that form (see its doc comment).'
		);
	}
	if (!/^(?:[^"\\]|\\\\)*$/.test(match[1])) {
		throw new Error(
			"cliff.toml's `[git] tag_pattern` uses a TOML escape this reader does not " +
				'decode; only `\\\\` is handled (see its doc comment).'
		);
	}
	return match[1].replace(/\\\\/g, '\\');
}

/**
 * What `git tag -l 'v[0-9]*'` — the exact glob `release.mjs` gathers `matchingTagsExist`
 * with — lists in a throwaway repo carrying `tags`. Constructed rather than reasoned
 * about: glob semantics are git's, not this suite's, to define.
 */
function tagsMatchingReleaseGlob(tags) {
	const repo = mkdtempSync(join(tmpdir(), 'release-tag-glob-'));
	// Config is passed per invocation so the developer's own global git config (commit
	// signing, hooks, templates, `init.defaultBranch`) cannot change the answer.
	const git = (...args) =>
		execFileSync(
			'git',
			[
				'-c',
				'commit.gpgsign=false',
				'-c',
				'user.email=t@example.com',
				'-c',
				'user.name=T',
				...args,
			],
			{ cwd: repo, encoding: 'utf8' }
		);

	try {
		git('init', '-q', '-b', 'main');
		git('commit', '-q', '--allow-empty', '-m', 'chore: init');
		for (const tag of tags) git('tag', tag);
		return git('tag', '-l', 'v[0-9]*')
			.split('\n')
			.filter((line) => line !== '');
	} finally {
		rmSync(repo, { force: true, recursive: true });
	}
}

describe('resetReleaseState', () => {
	it('resets the release-state files for a fresh downstream repo', () => {
		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(true);

		const pkg = readJson('package.json');
		expect(pkg.name).toBe('my-app');
		expect(pkg.version).toBe('0.0.0');

		const changelog = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');
		expect(changelog).not.toMatch(/^## \[/m);
		expect(changelog).toContain('# Changelog');
	});

	it('rewrites only the README H1, leaving upstream links pointing at the template', () => {
		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		const readme = readFileSync(join(fixtureRoot, 'README.md'), 'utf8');
		const lines = readme.split('\n');
		// The title is renamed to the project…
		expect(lines[0]).toBe('# my-app');
		// …but the intentional upstream reference (a NON-H1 `vibe-starter` mention) is
		// untouched — proving this is an H1-only rewrite, not a global replace.
		expect(readme).toContain(UPSTREAM_CHANGELOG_LINK);
		expect(readme).toContain('semi-sentient/vibe-starter');
	});

	it('leaves a README whose H1 is not the template name untouched', () => {
		const customReadme = '# Already Custom\n\nSome body text.\n';
		writeFileSync(join(fixtureRoot, 'README.md'), customReadme);

		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(readFileSync(join(fixtureRoot, 'README.md'), 'utf8')).toBe(customReadme);
	});

	it('resets the release state when no README is present', () => {
		rmSync(join(fixtureRoot, 'README.md'));

		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(true);
		expect(readJson('package.json').name).toBe('my-app');
	});

	it('is a no-op on re-run once the package is already renamed', () => {
		// First reset takes the fresh template to `my-app`; from then on the name is
		// no longer `vibe-starter`, so a later call (here with a different name) must
		// leave the accumulated CHANGELOG and bumped version untouched.
		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});
		const changelogAfterFirst = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');

		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'renamed-again',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(false);
		expect(summary.reason).toBeDefined();
		expect(readJson('package.json').name).toBe('my-app');
		expect(readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8')).toBe(changelogAfterFirst);
	});

	it.each([
		'git@github.com:semi-sentient/vibe-starter.git',
		'git@github.com:semi-sentient/vibe-starter',
		'https://github.com/semi-sentient/vibe-starter.git',
		'https://github.com/semi-sentient/vibe-starter',
	])('is a no-op when origin is the upstream template (%s)', (originUrl) => {
		// A fresh `projectName` would otherwise pass the name guards; the upstream
		// origin alone must short-circuit, leaving the template's own files intact.
		const summary = resetReleaseState({
			originUrl,
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(false);
		expect(readJson('package.json').name).toBe('vibe-starter');
	});

	it('is a no-op when the chosen project name is still the template name', () => {
		// Non-upstream origin, so only the `vibe-starter` name itself can short-circuit.
		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/whatever.git',
			projectName: 'vibe-starter',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(false);
		// The still-pre-reset version is the observable proof that the guard
		// short-circuited before anything was rewritten.
		expect(readJson('package.json').version).toBe('1.1.0');
	});

	it('preserves unrelated package.json fields and writes valid tab-indented JSON', () => {
		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		const pkg = readJson('package.json');
		// Only name + version change; everything else is carried through verbatim.
		expect(pkg.description).toBe(
			'An opinionated, MIT-licensed full-stack TypeScript starter template.'
		);
		expect(pkg.license).toBe('MIT');
		expect(pkg.private).toBe(true);
		expect(pkg.engines).toEqual({ node: '24.x' });
		expect(pkg.scripts.build).toBe('npm run build:web && npm run build:server');
		expect(pkg.dependencies.hono).toBeDefined();
		expect(pkg.devDependencies.vitest).toBeDefined();

		// Indentation is tabs (not spaces) so the pre-commit Prettier check is stable.
		const pkgRaw = readFileSync(join(fixtureRoot, 'package.json'), 'utf8');
		expect(pkgRaw).toMatch(/\n\t"name": "my-app",/);
		expect(pkgRaw).not.toMatch(/\n {2}"name"/);
		expect(pkgRaw.endsWith('\n')).toBe(true);

		// The CHANGELOG is byte-for-byte the header block above the first `## ` heading,
		// trailing blank line included — see PRE_RESET_CHANGELOG_HEADER for why exact.
		const changelog = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');
		expect(changelog).toBe(PRE_RESET_CHANGELOG_HEADER);
		// Asserted separately so the fixture itself can't silently lose that blank line.
		expect(changelog.endsWith('.\n\n')).toBe(true);
	});

	itInTemplate("emits a stub byte-identical to this repo's own CHANGELOG header block", () => {
		// The cases above use a synthetic header, so they pin the transformation but not
		// its coupling to reality. This one seeds the fixture with the LIVE CHANGELOG and
		// asserts the emitted stub equals the live header block byte-for-byte, so a future
		// edit to the intro prose cannot silently drift the two apart.
		//
		// Template-only: downstream the live CHANGELOG is the user's, and is already the
		// stub anyway, so this would degenerate into the idempotence check below while
		// gaining the power to redden their commits. The strong drift guard runs HERE.
		const liveChangelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
		const liveHeader = headerBlockOf(liveChangelog);
		writeFileSync(join(fixtureRoot, 'CHANGELOG.md'), liveChangelog);

		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		const stub = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');
		expect(
			stub,
			[
				"The downstream CHANGELOG stub drifted from this repo's own CHANGELOG header.",
				"Those bytes are also the release tooling's configured changelog header",
				"(`cliff.toml`'s `[changelog] header`): git-cliff `--prepend` `replacen`-s that",
				'exact string out of the file before re-emitting it, so a one-byte difference',
				'duplicates the header on the first release — in the template AND in every',
				'downstream repo, where the stub is the whole file.',
				'If you edited the CHANGELOG intro, copy the new bytes into `cliff.toml`;',
				'if the stub is wrong, fix `resetChangelog()`.',
			].join(' ')
		).toBe(liveHeader);
	});

	itInTemplate('re-emits an already-stubbed CHANGELOG byte-for-byte', () => {
		// The state of a repo generated from this template: `npm run setup` already ran,
		// so CHANGELOG.md IS the header stub and has no `## ` heading left. Running the
		// reset again must return the identical bytes — anything else and the stub stops
		// matching the release tooling's configured header the moment the reset is re-run.
		// Seeded from the LIVE header, so it is the only case exercising the no-`## `
		// branch of `resetChangelog()` — the branch downstream repos always take.
		const liveHeader = headerBlockOf(readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'));
		writeFileSync(join(fixtureRoot, 'CHANGELOG.md'), liveHeader);

		resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8')).toBe(liveHeader);
	});

	it('runs as a CLI deriving repoRoot from its own location: node script.mjs <name> <origin>', () => {
		// Mirrors Phase 2's bootstrap call. The script lives in `<repoRoot>/scripts/`
		// and derives `repoRoot` as its parent, so we co-locate it with the fixtures.
		const scriptsDir = join(fixtureRoot, 'scripts');
		mkdirSync(scriptsDir);
		const moduleUnderTest = fileURLToPath(
			new URL('./reset-release-state.mjs', import.meta.url)
		);
		cpSync(moduleUnderTest, join(scriptsDir, 'reset-release-state.mjs'));

		execFileSync('node', [
			join(scriptsDir, 'reset-release-state.mjs'),
			'my-app',
			'git@github.com:acme/my-app.git',
		]);

		const pkg = readJson('package.json');
		expect(pkg.name).toBe('my-app');
		expect(pkg.version).toBe('0.0.0');
	});
});

describe('cliff.toml', () => {
	itInTemplate("configures a changelog header byte-identical to this repo's CHANGELOG", () => {
		// The only thing coupling the two. The live-CHANGELOG case above derives BOTH
		// sides of its assertion from the same file, so a docs pass that rewords the intro
		// moves them together and leaves `cliff.toml` behind — silently, until someone
		// cuts a release and gets a duplicated header.
		const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
		const cliffToml = readFileSync(join(REPO_ROOT, 'cliff.toml'), 'utf8');

		expect(
			cliffChangelogHeader(cliffToml),
			[
				"`cliff.toml`'s `[changelog] header` drifted from this repo's CHANGELOG header.",
				'git-cliff `--prepend` `replacen`-s that exact string out of the file before',
				're-emitting it, so a one-byte difference duplicates the header on the next',
				'release — here AND in every downstream repo, where the header block is the',
				'whole CHANGELOG. Copy the current bytes above the first `## ` heading in',
				'CHANGELOG.md into `cliff.toml`.',
			].join(' ')
		).toBe(headerBlockOf(changelog));
	});

	itInTemplate('maps exactly the commit types the release refusals name', () => {
		// `release.mjs` names these types in two refusal messages, and nothing else couples
		// the sentence to the config. Drift is invisible until someone is told, wrongly,
		// which commit types would have produced a release.
		const cliffToml = readFileSync(join(REPO_ROOT, 'cliff.toml'), 'utf8');

		expect(
			cliffMappedCommitTypes(cliffToml).join(', '),
			[
				"`RELEASABLE_TYPES` in `scripts/release.mjs` drifted from `cliff.toml`'s mapped",
				'`commit_parsers` (the entries with a `group`; the trailing `skip = true`',
				'catch-all is not one). That string is the list `npm run release` prints when it',
				'refuses — a maintainer told the wrong set of types either ships nothing or',
				'writes a commit that still produces no release. Copy the mapped types, in',
				'`cliff.toml` order, into `RELEASABLE_TYPES`.',
			].join(' ')
		).toBe(RELEASABLE_TYPES);
	});

	itInTemplate('refuses a release when the tag glob matches tags `tag_pattern` cannot', () => {
		// The two patterns are different dialects on purpose, and this constructs the gap
		// between them instead of assuming it: real tags, listed by the real glob, tested
		// against the real configured pattern. (`^v[0-9]+\.…$` is the same expression in
		// Rust and JS, so `RegExp` is a faithful stand-in for git-cliff's matcher.)
		const unreadable = ['v1.2', 'v1.3.0-rc.1', 'v2024.01'];
		const globbed = tagsMatchingReleaseGlob([...unreadable, 'vibe-starter-v1.3.2']);
		expect(globbed).toEqual(unreadable);

		const tagPattern = new RegExp(
			cliffTagPattern(readFileSync(join(REPO_ROOT, 'cliff.toml'), 'utf8'))
		);
		expect(globbed.some((tag) => tagPattern.test(tag))).toBe(false);

		// So `matchingTagsExist` is true — this is NOT a first release — while git-cliff
		// has no baseline: `--bumped-version` exits 1 with empty stdout and the CLI gathers
		// `''`. Planning a release from that would tag `v` and `npm version ''`.
		const plan = planRelease({
			bumpedVersion: '',
			currentBranch: 'main',
			currentVersion: '1.2.0',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: globbed.length > 0,
		});

		expect(plan.action).toBe('refuse');
		expect(plan.reason).toContain('`vX.Y.Z`');
	});
});
