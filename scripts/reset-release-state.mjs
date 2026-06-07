import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resets release-please's version state in a freshly-cloned downstream copy of
 * this template so the next release starts from a clean `0.1.0`, then renames the
 * package to the new project. A no-op unless this is genuinely a downstream repo
 * (see the guards in {@link resetReleaseState}).
 *
 * Dependency-free Node ESM (only Node built-ins: `node:fs`/`node:path`/`node:url`)
 * so it runs under bare `node` during bootstrap, before `npm install` — do NOT add
 * imports that need `node_modules`. Progress is written with `process.stdout.write`;
 * never `console.log` (the repo's `no-console` rule forbids it, and bootstrap parses
 * stdout).
 */

/** The template's own package name; the reset is a no-op when it's still this. */
const TEMPLATE_NAME = 'vibe-starter';

/**
 * Matches an origin URL that points at the upstream template repo in either
 * remote form, with or without a trailing `.git`:
 * - SSH:   `git@github.com:semi-sentient/vibe-starter(.git)`
 * - HTTPS: `https://github.com/semi-sentient/vibe-starter(.git)`
 */
const UPSTREAM_ORIGIN = /[:/]semi-sentient\/vibe-starter(\.git)?$/;

/**
 * Rewrite a JSON file in place after mutating its parsed contents, preserving the
 * repo's tab indentation so the pre-commit Prettier check leaves it untouched.
 */
function rewriteJson(filePath, mutate) {
	const data = JSON.parse(readFileSync(filePath, 'utf8'));
	mutate(data);
	writeFileSync(filePath, JSON.stringify(data, null, '\t') + '\n');
}

/**
 * Replace the CHANGELOG with just its header and intro paragraph — every version
 * entry is dropped so release-please prepends the downstream repo's first release
 * itself. The stub is derived by truncating at the first `## ` heading rather than
 * hardcoded, so it tracks edits to the template's intro wording.
 */
function resetChangelog(filePath) {
	const current = readFileSync(filePath, 'utf8');
	const firstEntry = current.indexOf('\n## ');
	const stub = firstEntry === -1 ? current : current.slice(0, firstEntry);
	writeFileSync(filePath, stub.trimEnd() + '\n');
}

/**
 * Rewrite the README's H1 from the template name to the new project name. This is
 * deliberately H1-ONLY (not a global `s/vibe-starter/…/g`): the README intentionally
 * references the upstream template — the `[CHANGELOG](…/semi-sentient/vibe-starter/…)`
 * link and the "snapshot, not a dependency" note must keep pointing upstream.
 *
 * No-op when the README is absent, or when its first line is not exactly the
 * template H1 (`# vibe-starter`) — i.e. an already-renamed or customized title is
 * left untouched, keeping the rewrite idempotent and safe. Only the title line
 * changes; the rest of the file is preserved byte-for-byte.
 */
function resetReadmeTitle(filePath, projectName) {
	if (!existsSync(filePath)) return;

	const current = readFileSync(filePath, 'utf8');
	const newlineIndex = current.indexOf('\n');
	const firstLine = newlineIndex === -1 ? current : current.slice(0, newlineIndex);
	if (firstLine !== `# ${TEMPLATE_NAME}`) return;

	const rest = newlineIndex === -1 ? '' : current.slice(newlineIndex);
	writeFileSync(filePath, `# ${projectName}${rest}`);
	process.stdout.write(`Renamed README title to "${projectName}"\n`);
}

/**
 * Reset downstream release-please state and rename the package.
 *
 * `originUrl` is passed IN (not read from git here) so the upstream-remote guard
 * is testable without a real remote — the CLI wrapper resolves it via
 * `git remote get-url origin`.
 *
 * No-op (returns `{ reset: false, reason }`) when ANY guard holds, so callers can
 * invoke it unconditionally during bootstrap:
 * - `originUrl` still points at the upstream template (`semi-sentient/vibe-starter`),
 * - `projectName` is `vibe-starter` (nothing to rename to),
 * - the current `package.json` name is already not `vibe-starter` (already
 *   initialized — keeps a re-run idempotent and the accumulated CHANGELOG/version
 *   intact).
 *
 * @param {{ repoRoot: string, projectName: string, originUrl: string }} options
 * @returns {{ reset: boolean, reason?: string }} `{ reset: true }` when the files
 *   were rewritten; `{ reset: false, reason }` when a guard short-circuited.
 */
export function resetReleaseState({ originUrl, projectName, repoRoot }) {
	if (UPSTREAM_ORIGIN.test(originUrl)) {
		return { reason: 'origin is the upstream template', reset: false };
	}
	if (projectName === TEMPLATE_NAME) {
		return { reason: 'project name is still the template name', reset: false };
	}

	const manifestPath = join(repoRoot, '.release-please-manifest.json');
	const packagePath = join(repoRoot, 'package.json');
	const configPath = join(repoRoot, 'release-please-config.json');
	const changelogPath = join(repoRoot, 'CHANGELOG.md');
	const readmePath = join(repoRoot, 'README.md');

	const currentName = JSON.parse(readFileSync(packagePath, 'utf8')).name;
	if (currentName !== TEMPLATE_NAME) {
		return { reason: 'package is already renamed', reset: false };
	}

	process.stdout.write(`Resetting release state for "${projectName}"\n`);

	rewriteJson(manifestPath, (manifest) => {
		manifest['.'] = '0.0.0';
	});

	rewriteJson(packagePath, (pkg) => {
		pkg.name = projectName;
		pkg.version = '0.0.0';
	});

	rewriteJson(configPath, (config) => {
		const root = config.packages['.'];
		root['include-component-in-tag'] = false;
		root['initial-version'] = '0.1.0';
		root['package-name'] = projectName;
	});

	resetChangelog(changelogPath);

	resetReadmeTitle(readmePath, projectName);

	process.stdout.write('Release state reset complete\n');

	return { reset: true };
}

// CLI entry point for bootstrap: `node scripts/reset-release-state.mjs <name> <origin>`.
// `repoRoot` is derived from this file's location (the parent of `scripts/`), not
// `process.cwd()`, so the call works regardless of the caller's working directory.
// Importing the module (e.g. from tests) does NOT run this block.
if (import.meta.main) {
	const [, , projectName, originUrl] = process.argv;
	resetReleaseState({
		originUrl: originUrl ?? '',
		projectName: projectName ?? '',
		repoRoot: join(dirname(fileURLToPath(import.meta.url)), '..'),
	});
}
