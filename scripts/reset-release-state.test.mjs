import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

	it("emits a stub byte-identical to this repo's own CHANGELOG header block", () => {
		// The cases above use a synthetic header, so they pin the transformation but not
		// its coupling to reality. This one seeds the fixture with the LIVE CHANGELOG and
		// asserts the emitted stub equals the live header block byte-for-byte, so a future
		// edit to the intro prose cannot silently drift the two apart.
		//
		// In a repo generated from this template the live CHANGELOG is already the stub,
		// so `headerBlockOf` returns the whole file and this degenerates into the same
		// idempotence check as the case below — still a true statement, just a weaker one.
		// The strong drift guard is what runs HERE, in the template.
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

	it('re-emits an already-stubbed CHANGELOG byte-for-byte', () => {
		// The state of a repo generated from this template: `npm run setup` already ran,
		// so CHANGELOG.md IS the header stub and has no `## ` heading left. Running the
		// reset again must return the identical bytes — anything else and the stub stops
		// matching the release tooling's configured header the moment the reset is re-run.
		// Seeded from the LIVE header so this case runs identically in the template and
		// downstream; in the template it is the only case that exercises the no-`## `
		// branch of `resetChangelog()`, which is the branch downstream repos always take.
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
