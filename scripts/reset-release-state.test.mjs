import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetReleaseState } from './reset-release-state.mjs';

// The repo root holds the four release-state files in their PRE-reset state
// (name `vibe-starter`, version/manifest `1.1.0`, a full CHANGELOG). We seed each
// fixture by copying those real files, so the "before" state tracks ground truth
// instead of a hand-maintained literal that could drift.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_STATE_FILES = [
	'.release-please-manifest.json',
	'CHANGELOG.md',
	'package.json',
	'release-please-config.json',
];

/** A throwaway repo seeded with the template's pre-reset release-state files. */
let fixtureRoot;

beforeEach(() => {
	fixtureRoot = mkdtempSync(join(tmpdir(), 'reset-release-state-'));
	for (const file of RELEASE_STATE_FILES) {
		cpSync(join(repoRoot, file), join(fixtureRoot, file));
	}
});

afterEach(() => {
	rmSync(fixtureRoot, { force: true, recursive: true });
});

/** Read + parse a JSON file from the fixture root. */
function readJson(file) {
	return JSON.parse(readFileSync(join(fixtureRoot, file), 'utf8'));
}

describe('resetReleaseState', () => {
	it('resets all four files for a fresh downstream repo', () => {
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
		expect(pkg.description).toBe('An opinionated, MIT-licensed full-stack TypeScript starter template.');
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
		const moduleUnderTest = fileURLToPath(new URL('./reset-release-state.mjs', import.meta.url));
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
