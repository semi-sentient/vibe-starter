import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	planRelease,
	ReleaseRefusedError,
	resolveNpmArgv,
	runReleaseCommands,
} from './release.mjs';

// A one-element stand-in for the git-cliff argv prefix the CLI injects (really
// `[node, …/git-cliff/lib/cli/cli.js]`). An obviously-absolute value proves the plan
// carries the argv it was given rather than emitting a bare `git-cliff` that only
// resolves under `npm run`; the real two-element Windows shape is pinned by the win32
// case below.
//
// `cliff.toml` itself is covered next door in `reset-release-state.test.mjs`, which
// already owns the CHANGELOG-header helpers its assertion needs.
const GIT_CLIFF = '/repo/node_modules/.bin/git-cliff';

describe('planRelease', () => {
	it('refuses to release from a dirty working tree', () => {
		const plan = planRelease({
			bumpedVersion: '1.4.0',
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			isDirty: true,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		expect(plan.reason).toBe('the working tree has uncommitted changes');
	});

	it('refuses to release from a branch that is not the default one', () => {
		const plan = planRelease({
			bumpedVersion: '1.4.0',
			currentBranch: 'plan/reduce-pr-release-friction',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		expect(plan.reason).toBe(
			'the current branch is `plan/reduce-pr-release-friction`, not the default branch `main` — a release commit, tag and GitHub release must all land on `main`'
		);
	});

	it('refuses with an empty-window reason when nothing at all has landed', () => {
		const plan = planRelease({
			bumpedVersion: '1.3.2',
			commitsSinceLastRelease: 0,
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		expect(plan.reason).toBe('there are no commits at all since the last release');
	});

	it('refuses with a filtered-window reason when the commits are all of hidden types', () => {
		// A batch of merged Dependabot PRs is the everyday case: `cliff.toml`'s catch-all
		// hides `chore`/`build`/`docs`/`ci`, so the window looks identical to an empty one
		// from `--bumped-version` alone. The maintainer has to be able to tell them apart.
		const plan = planRelease({
			bumpedVersion: '1.3.2',
			commitsSinceLastRelease: 7,
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		expect(plan.reason).toBe(
			'there are 7 commits since the last release, but none of a type that appears in the changelog (feat, fix, perf, revert, deprecate, security) — chore, build, docs and ci commits are excluded by design. To ship them anyway, land one commit of a listed type (for example `git commit --allow-empty -m "fix: refresh dependencies"`) and run `npm run release` again.'
		);
	});

	it('refuses when only a leading `v` distinguishes the bumped version from the current one', () => {
		// `git-cliff --bumped-version` may print `v1.3.2` while `package.json` never
		// carries the prefix. Without normalization the two never compare equal and the
		// refuse path above would be dead code.
		const plan = planRelease({
			bumpedVersion: 'v1.3.2',
			commitsSinceLastRelease: 1,
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		// Singular, and the same escape hatch.
		expect(plan.reason).toMatch(
			/^there is 1 commit since the last release, but none of a type/
		);
	});

	it('refuses when the repo has version tags but none of the shape the tooling reads', () => {
		// The gathering glob (`git tag -l 'v[0-9]*'`) is deliberately looser than
		// `cliff.toml`'s anchored `tag_pattern`, so a repo tagged `v1.2` / `v1.3.0-rc.1` /
		// `v2024.01` reports `matchingTagsExist: true` — this is not a first release — yet
		// `--bumped-version` finds no baseline, exits non-zero and the CLI gathers `''`.
		// That the two patterns really do disagree on those tags is constructed for real
		// in the `cliff.toml` suite in `reset-release-state.test.mjs`.
		const plan = planRelease({
			bumpedVersion: '',
			commitsSinceLastRelease: 4,
			currentBranch: 'main',
			currentVersion: '1.2.0',
			defaultBranch: 'main',
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('refuse');
		// Names the mismatch and the remedy — the same alias-tag move this template made
		// for its own legacy `vibe-starter-v*` tags.
		expect(plan.reason).toContain('`vX.Y.Z`');
		expect(plan.reason).toContain('git tag -a v1.2.0');
	});

	it.each(['v1.2', '1.2.3.4', '1.2.3-rc.1', 'main'])(
		'refuses rather than tagging an unusable version (%s)',
		(bumpedVersion) => {
			// The contract's own backstop, independent of how the CLI gathers. Without it
			// `planRelease` happily emits `git tag -a v1.2 …` / `npm version 1.2 …`, and the
			// only thing keeping that unreachable today is git-cliff exiting non-zero first.
			// Pre-release forms are refused too, on purpose: `cliff.toml`'s anchored
			// `tag_pattern` would not match the tag they produce, so the release AFTER one
			// would have no baseline — the very state the refusal above exists to explain.
			const plan = planRelease({
				bumpedVersion,
				currentBranch: 'main',
				currentVersion: '1.1.0',
				defaultBranch: 'main',
				isDirty: false,
				matchingTagsExist: true,
			});

			expect(plan.action).toBe('refuse');
			expect(plan.reason).toContain(bumpedVersion);
			expect(plan.commands).toBeUndefined();
			// Distinct from the "tags exist but are unreadable" refusal above: this one is
			// about the answer that came back, not about the tags it was derived from.
			expect(plan.reason).not.toContain('already has version tags');
		}
	);

	it('plans the ordered release commands for a normal bump', () => {
		const plan = planRelease({
			bumpedVersion: 'v1.4.0',
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			gitCliffArgv: [GIT_CLIFF],
			isDirty: false,
			matchingTagsExist: true,
		});

		expect(plan.action).toBe('release');
		// The plan's `version` is always bare; the `v` is re-added per command.
		expect(plan.version).toBe('1.4.0');
		expect(plan.commands).toEqual([
			// The notes capture is FIRST and read-only: it is the only chance to see that
			// the release would be contentless while nothing has been touched yet.
			{
				argv: [GIT_CLIFF, '--unreleased', '--tag', 'v1.4.0', '--strip', 'all'],
				captureStdout: 'notes',
				refuseIfEmpty: expect.stringContaining('empty'),
			},
			{ argv: [GIT_CLIFF, '--unreleased', '--tag', 'v1.4.0', '--prepend', 'CHANGELOG.md'] },
			{ argv: ['npm', 'version', '1.4.0', '--no-git-tag-version'] },
			{ argv: ['git', 'add', 'CHANGELOG.md', 'package.json', 'package-lock.json'] },
			{ argv: ['git', 'commit', '-m', 'chore(release): v1.4.0'] },
			{ argv: ['git', 'tag', '-a', 'v1.4.0', '-m', 'v1.4.0'] },
			{ argv: ['git', 'push', '--follow-tags'] },
			{
				argv: ['gh', 'release', 'create', 'v1.4.0', '--notes-file', '-'],
				stdinFrom: 'notes',
			},
		]);
	});

	it('emits a win32 plan that spawns only real executables', () => {
		// On Windows both `git-cliff` and `npm` are `.cmd` shims in `node_modules/.bin` /
		// beside `node.exe`, and `execFileSync` cannot spawn those without a shell. The
		// plan therefore carries `node <shim>.js` for both, so nothing the executor runs
		// is a batch file and no argument is ever re-parsed by `cmd.exe`.
		const node = 'C:\\Program Files\\nodejs\\node.exe';
		const plan = planRelease({
			bumpedVersion: 'v1.4.0',
			currentBranch: 'main',
			currentVersion: '1.3.2',
			defaultBranch: 'main',
			gitCliffArgv: [node, 'C:\\repo\\node_modules\\git-cliff\\lib\\cli\\cli.js'],
			isDirty: false,
			matchingTagsExist: true,
			npmArgv: [node, 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
		});

		expect(plan.action).toBe('release');
		const executables = plan.commands.map((command) => command.argv[0]);
		expect(executables).toEqual([node, node, node, 'git', 'git', 'git', 'git', 'gh']);
		const allArguments = plan.commands.flatMap((command) => command.argv);
		expect(allArguments.some((entry) => /\.(cmd|bat)$/i.test(entry))).toBe(false);
		// The commit subject stays one argv element — it is never handed to a shell.
		expect(plan.commands.map((command) => command.argv)).toContainEqual([
			'git',
			'commit',
			'-m',
			'chore(release): v1.4.0',
		]);
	});

	it('seeds the first release at 0.1.0 when no matching tag exists yet', () => {
		// The state of a repo generated from this template: `npm run setup` zeroed the
		// version and no `vX.Y.Z` tag was ever cut, so whatever git-cliff computed from
		// the inherited history is discarded in favour of a clean 0.1.0.
		const plan = planRelease({
			bumpedVersion: '1.4.0',
			currentBranch: 'main',
			currentVersion: '0.0.0',
			defaultBranch: 'main',
			gitCliffArgv: [GIT_CLIFF],
			isDirty: false,
			matchingTagsExist: false,
		});

		expect(plan.action).toBe('release');
		expect(plan.version).toBe('0.1.0');
		expect(plan.commands.map((command) => command.argv)).toEqual([
			[GIT_CLIFF, '--unreleased', '--tag', 'v0.1.0', '--strip', 'all'],
			[GIT_CLIFF, '--unreleased', '--tag', 'v0.1.0', '--prepend', 'CHANGELOG.md'],
			['npm', 'version', '0.1.0', '--no-git-tag-version'],
			['git', 'add', 'CHANGELOG.md', 'package.json', 'package-lock.json'],
			['git', 'commit', '-m', 'chore(release): v0.1.0'],
			['git', 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0'],
			['git', 'push', '--follow-tags'],
			['gh', 'release', 'create', 'v0.1.0', '--notes-file', '-'],
		]);
	});

	it('seeds the first release even when no bumped version could be computed', () => {
		// The contract the CLI relies on: before the first matching tag exists,
		// `git-cliff --bumped-version` cannot succeed — it computes a bare `0.1.0` and
		// then rejects it against `tag_pattern` (`^v…`), exiting non-zero. The CLI
		// therefore skips that call entirely and passes an empty bumped version, which
		// must still plan the seeded first release rather than refuse.
		const plan = planRelease({
			bumpedVersion: '',
			currentBranch: 'main',
			currentVersion: '0.0.0',
			defaultBranch: 'main',
			gitCliffArgv: [GIT_CLIFF],
			isDirty: false,
			matchingTagsExist: false,
		});

		expect(plan.action).toBe('release');
		expect(plan.version).toBe('0.1.0');
	});
});

describe('resolveNpmArgv', () => {
	// The `platform` is a parameter, never `process.platform`, so the Windows shape is
	// asserted from any host. Paths are built with the same `join` as the module, so the
	// separator is the host's — what is pinned is the *shape*: node plus a `.js` shim,
	// and above all never a `.cmd`, which `execFileSync` refuses to spawn without a shell
	// (the CVE-2024-27980 fix, Node ≥18.20.2/20.12.2).
	const NODE = '/nodes/v24/bin/node';

	it('runs npm through node and its JS shim on win32, never through npm.cmd', () => {
		const shim = join(dirname(NODE), 'node_modules', 'npm', 'bin', 'npm-cli.js');
		const argv = resolveNpmArgv({
			execPath: NODE,
			fileExists: (path) => path === shim,
			npmExecPath: undefined,
			platform: 'win32',
		});

		expect(argv).toEqual([NODE, shim]);
		expect(argv.some((entry) => entry.endsWith('.cmd'))).toBe(false);
	});

	it('finds the npm shim in the POSIX layout, one level up under lib', () => {
		const shim = join(dirname(NODE), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
		const argv = resolveNpmArgv({
			execPath: NODE,
			fileExists: (path) => path === shim,
			npmExecPath: undefined,
			platform: 'darwin',
		});

		expect(argv).toEqual([NODE, shim]);
	});

	it('prefers the npm that invoked the script over any layout guess', () => {
		// `npm run release` exports `npm_execpath` as the absolute path of `npm-cli.js`.
		// That is the authoritative answer on every platform and every install layout.
		const argv = resolveNpmArgv({
			execPath: NODE,
			fileExists: () => false,
			npmExecPath: '/somewhere/odd/npm/bin/npm-cli.js',
			platform: 'win32',
		});

		expect(argv).toEqual([NODE, '/somewhere/odd/npm/bin/npm-cli.js']);
	});

	it('falls back to a bare npm when no shim can be located', () => {
		const argv = resolveNpmArgv({
			execPath: NODE,
			fileExists: () => false,
			npmExecPath: undefined,
			platform: 'darwin',
		});

		expect(argv).toEqual(['npm']);
	});
});

describe('runReleaseCommands', () => {
	it('threads a captured stdout slot into the command that consumes it', () => {
		const run = vi.fn(({ argv }) =>
			argv.includes('--strip') ? '### Added\n\n- A feature.\n' : ''
		);

		runReleaseCommands(
			[
				{ argv: ['git-cliff', '--strip', 'all'], captureStdout: 'notes' },
				{
					argv: ['gh', 'release', 'create', 'v1.4.0', '--notes-file', '-'],
					stdinFrom: 'notes',
				},
			],
			run
		);

		expect(run).toHaveBeenCalledTimes(2);
		// The producer runs with no stdin…
		expect(run).toHaveBeenNthCalledWith(1, { argv: ['git-cliff', '--strip', 'all'] });
		// …and the consumer receives exactly what the producer printed.
		expect(run).toHaveBeenNthCalledWith(2, {
			argv: ['gh', 'release', 'create', 'v1.4.0', '--notes-file', '-'],
			stdin: '### Added\n\n- A feature.\n',
		});
	});

	it('stops before the first mutating command when the notes are only a version heading', () => {
		// The first-release path bypasses the "nothing releasable" refusal by construction,
		// so a repo whose only commit is `Initial commit` reaches here. git-cliff exits 0
		// and prints the bare heading — which would become an empty CHANGELOG section and
		// empty GitHub release notes if it were allowed through.
		const run = vi.fn(() => '## [0.1.0] - 2026-08-01\n\n');

		expect(() =>
			runReleaseCommands(
				[
					{
						argv: ['git-cliff', '--strip', 'all'],
						captureStdout: 'notes',
						refuseIfEmpty: 'v0.1.0 would have an empty changelog.',
					},
					{ argv: ['git-cliff', '--prepend', 'CHANGELOG.md'] },
				],
				run
			)
		).toThrow(ReleaseRefusedError);

		// Only the read-only capture ran; the CHANGELOG was never touched.
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('accepts notes that carry a heading plus real content', () => {
		const run = vi.fn(() => '## [0.1.0] - 2026-08-01\n\n### Added\n\n- A feature\n');

		expect(() =>
			runReleaseCommands(
				[
					{
						argv: ['git-cliff', '--strip', 'all'],
						captureStdout: 'notes',
						refuseIfEmpty: 'v0.1.0 would have an empty changelog.',
					},
					{ argv: ['git-cliff', '--prepend', 'CHANGELOG.md'] },
				],
				run
			)
		).not.toThrow();

		expect(run).toHaveBeenCalledTimes(2);
	});
});
