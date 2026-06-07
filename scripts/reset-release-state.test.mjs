import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetReleaseState } from './reset-release-state.mjs';

// Each fixture is seeded from KNOWN, LITERAL pre-reset content (name `vibe-starter`,
// version/manifest `1.1.0`, a full CHANGELOG, a `# vibe-starter` README) rather than
// by copying the live repo's own state files. That makes the suite self-contained:
// it asserts the exact same outcome in this template AND in any repo generated from
// it that has already run `npm run setup` (where those live files are already reset).
// The literals below only need the fields the assertions touch.
const PRE_RESET_MANIFEST = { '.': '1.1.0' };

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

const PRE_RESET_CONFIG = {
	$schema: 'https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json',
	'changelog-sections': [
		{ type: 'feat', section: 'Added' },
		{ type: 'fix', section: 'Fixed' },
		{ type: 'perf', section: 'Changed' },
		{ type: 'revert', section: 'Removed' },
		{ type: 'deprecate', section: 'Deprecated' },
		{ type: 'security', section: 'Security' },
	],
	packages: {
		'.': {
			'changelog-path': 'CHANGELOG.md',
			'package-name': 'vibe-starter',
			'release-type': 'node',
		},
	},
};

const PRE_RESET_CHANGELOG = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-01

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
		join(fixtureRoot, '.release-please-manifest.json'),
		JSON.stringify(PRE_RESET_MANIFEST, null, '\t') + '\n'
	);
	writeFileSync(
		join(fixtureRoot, 'package.json'),
		JSON.stringify(PRE_RESET_PACKAGE, null, '\t') + '\n'
	);
	writeFileSync(
		join(fixtureRoot, 'release-please-config.json'),
		JSON.stringify(PRE_RESET_CONFIG, null, '\t') + '\n'
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

describe('resetReleaseState', () => {
	it('resets the release-state files for a fresh downstream repo', () => {
		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/my-app.git',
			projectName: 'my-app',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(true);

		expect(readJson('.release-please-manifest.json')).toEqual({ '.': '0.0.0' });

		const pkg = readJson('package.json');
		expect(pkg.name).toBe('my-app');
		expect(pkg.version).toBe('0.0.0');

		const config = readJson('release-please-config.json');
		expect(config.packages['.']).toMatchObject({
			'include-component-in-tag': false,
			'initial-version': '0.1.0',
			'package-name': 'my-app',
		});

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
		expect(readJson('.release-please-manifest.json')).toEqual({ '.': '1.1.0' });
	});

	it('is a no-op when the chosen project name is still the template name', () => {
		// Non-upstream origin, so only the `vibe-starter` name itself can short-circuit.
		const summary = resetReleaseState({
			originUrl: 'git@github.com:acme/whatever.git',
			projectName: 'vibe-starter',
			repoRoot: fixtureRoot,
		});

		expect(summary.reset).toBe(false);
		expect(readJson('.release-please-manifest.json')).toEqual({ '.': '1.1.0' });
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

		// The release-please config keeps its top-level schema + sections untouched.
		const config = readJson('release-please-config.json');
		expect(config.$schema).toContain('release-please');
		expect(config['changelog-sections']).toHaveLength(6);

		// The CHANGELOG is exactly the title + intro paragraph, one trailing newline.
		const changelog = readFileSync(join(fixtureRoot, 'CHANGELOG.md'), 'utf8');
		expect(changelog).toContain('The format is based on [Keep a Changelog]');
		expect(changelog.endsWith('\n')).toBe(true);
		expect(changelog.endsWith('\n\n')).toBe(false);
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

		expect(readJson('package.json').name).toBe('my-app');
		expect(readJson('.release-please-manifest.json')).toEqual({ '.': '0.0.0' });
	});
});
