import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	CI_WORKFLOW_PATH,
	extractCiJobNames,
	GATE_CHECK_NAMES,
	gatherSetupState,
	isGithubOrigin,
	parseMode,
	planGithubSetup,
	RULESET_NAME,
	runSetupCommands,
} from './setup-github.mjs';

// This file lives in `<repoRoot>/scripts/`, so the repo root is its parent. Derived from
// the module URL, never `process.cwd()`.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * True only in the template repo itself.
 *
 * A SECOND copy of the helper in `reset-release-state.mjs`'s suite, which is the one place
 * the rule is written down: any test in `scripts/**` that reads a live repo file must be
 * guarded, because these files ship downstream and gate every commit there (pre-commit →
 * `npm run build:validate` → `npm test`). The live file read below is
 * `.github/workflows/ci.yml`, whose job names a downstream user may rename or delete quite
 * legitimately — that must skip their test, not redden their commit. Two copies of a
 * four-line predicate is the repo's "extract at the third copy" threshold; a third caller
 * should pull it into a shared module.
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

// The ruleset body this script exists to install, spelled out rather than derived from the
// module: three required status checks, nothing about reviews or pull requests, and
// `~DEFAULT_BRANCH` so the payload survives a repo whose default branch is not `main`.
// Written as the parsed object because JSON key order is not part of the contract.
const EXPECTED_RULESET = {
	conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
	enforcement: 'active',
	name: 'main-required-checks',
	rules: [
		{
			parameters: {
				required_status_checks: [
					{ context: 'Build & test' },
					{ context: 'Secret scan' },
					{ context: 'Docker smoke' },
				],
				strict_required_status_checks_policy: false,
			},
			type: 'required_status_checks',
		},
	],
	target: 'branch',
};

// Verbatim from `gh api --method POST …/rulesets` on a PRIVATE repository on the GitHub
// Free plan, where rulesets are a paid feature. This is not a hypothetical: it is what an
// admin of a brand-new private repo created from this template hits on their first
// `npm run setup`, and the reason the apply path has to be quiet in `auto` mode.
const GH_REFUSAL =
	'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';

// A state in which every precondition is met, so each case below can knock out exactly
// one rung and assert on that rung alone.
const READY = {
	ciJobNames: [
		'Build & test',
		'Cross-platform build (${{ matrix.os }})',
		'Secret scan',
		'Docker smoke',
	],
	existingRulesets: [],
	ghAuthed: true,
	ghInstalled: true,
	mode: 'auto',
	originIsGithub: true,
	viewerPermission: 'ADMIN',
};

describe('planGithubSetup', () => {
	it('skips quietly when the GitHub CLI is not installed', () => {
		const plan = planGithubSetup({ ...READY, ghInstalled: false, mode: 'auto' });

		expect(plan.action).toBe('skip');
		expect(plan.reason).toContain('`gh`');
		expect(plan.commands).toBeUndefined();
	});

	it('fails loudly when the GitHub CLI is not installed and it was asked for explicitly', () => {
		const plan = planGithubSetup({ ...READY, ghInstalled: false, mode: 'explicit' });

		expect(plan.action).toBe('fail');
		expect(plan.reason).toContain('`gh`');
		expect(plan.commands).toBeUndefined();
	});

	// One knocked-out rung each, in ladder order. `expect` is what the reason must name so
	// the user can act on it without reading this file.
	const UNMET_RUNGS = [
		{ expect: 'gh auth login', rung: 'not signed in', state: { ghAuthed: false } },
		{ expect: '`origin`', rung: 'origin is not on GitHub', state: { originIsGithub: false } },
		{
			expect: 'admin access',
			rung: 'the user is not an admin',
			state: { viewerPermission: 'MAINTAIN' },
		},
		{
			expect: '`Docker smoke`',
			rung: 'a required CI job has been renamed',
			state: { ciJobNames: ['Build & test', 'Secret scan'] },
		},
	];

	it.each(UNMET_RUNGS)('skips quietly when $rung', ({ expect: needle, state }) => {
		const plan = planGithubSetup({ ...READY, ...state, mode: 'auto' });

		expect(plan.action).toBe('skip');
		expect(plan.reason).toContain(needle);
		expect(plan.commands).toBeUndefined();
	});

	it.each(UNMET_RUNGS)('fails loudly when $rung', ({ expect: needle, state }) => {
		const plan = planGithubSetup({ ...READY, ...state, mode: 'explicit' });

		expect(plan.action).toBe('fail');
		expect(plan.reason).toContain(needle);
		expect(plan.commands).toBeUndefined();
	});

	it('gives every precondition its own reason', () => {
		// A shared or copy-pasted reason would send the user to fix the wrong thing, and
		// the ladder short-circuits so only one is ever shown.
		const reasons = [{ ghInstalled: false }, ...UNMET_RUNGS.map((rung) => rung.state)].map(
			(state) => planGithubSetup({ ...READY, ...state }).reason
		);

		expect(new Set(reasons).size).toBe(reasons.length);
	});

	it('names every missing gate check, not just the first', () => {
		const plan = planGithubSetup({ ...READY, ciJobNames: ['Build & test'] });

		expect(plan.reason).toContain('`Secret scan`');
		expect(plan.reason).toContain('`Docker smoke`');
	});

	it('creates the ruleset and applies the merge settings when every rung is met', () => {
		const plan = planGithubSetup(READY);

		expect(plan.action).toBe('apply');
		expect(plan.commands).toHaveLength(2);

		const [ruleset, settings] = plan.commands;
		// `{owner}`/`{repo}` are gh's own placeholders — it fills them from the repository
		// of the current directory, so nothing has to gather the slug.
		expect(ruleset.argv).toEqual([
			'gh',
			'api',
			'--method',
			'POST',
			'/repos/{owner}/{repo}/rulesets',
			'--input',
			'-',
		]);
		expect(JSON.parse(ruleset.stdin)).toEqual(EXPECTED_RULESET);

		expect(settings.argv).toEqual([
			'gh',
			'api',
			'--method',
			'PATCH',
			'/repos/{owner}/{repo}',
			'--input',
			'-',
		]);
		expect(JSON.parse(settings.stdin)).toEqual({
			allow_auto_merge: true,
			delete_branch_on_merge: true,
		});
	});

	it('updates the existing ruleset in place rather than creating a second one', () => {
		const plan = planGithubSetup({
			...READY,
			existingRulesets: [
				{ id: 111, name: 'some other ruleset' },
				{ id: 4242, name: RULESET_NAME },
			],
		});

		expect(plan.action).toBe('apply');
		const [ruleset] = plan.commands;
		expect(ruleset.argv).toEqual([
			'gh',
			'api',
			'--method',
			'PUT',
			'/repos/{owner}/{repo}/rulesets/4242',
			'--input',
			'-',
		]);
		// Same body either way — only the verb and path change.
		expect(JSON.parse(ruleset.stdin)).toEqual(EXPECTED_RULESET);
		// Nothing in the plan may POST, or a re-run leaves two rulesets behind, both active.
		expect(plan.commands.flatMap((command) => command.argv)).not.toContain('POST');
	});

	it('describes each change in one plain line', () => {
		// The CLI prints these verbatim, so the wording belongs to the decision core where
		// it can be asserted.
		const plan = planGithubSetup(READY);

		expect(plan.commands).toHaveLength(2);
		for (const command of plan.commands) {
			expect(command.describe).toMatch(/^\S.*\S$/);
			expect(command.describe).not.toContain('\n');
		}
	});

	it('refuses when the workflow could not be read at all', () => {
		// The reader resolves an unreadable `ci.yml` to no job names. Applying anyway would
		// point three required checks at contexts nothing produces.
		const plan = planGithubSetup({ ...READY, ciJobNames: [] });

		expect(plan.action).toBe('skip');
		expect(plan.reason).toContain('`Build & test`');
	});
});

describe('runSetupCommands', () => {
	/**
	 * An apply-side runner. Records every command it was handed and fails the ones whose
	 * joined argv contains one of `failing`, answering with gh's own words on stderr —
	 * the `{ ok, stderr }` shape the CLI's executor produces.
	 */
	function stubApplyRunner(failing = []) {
		const calls = [];
		const run = ({ argv, stdin }) => {
			const command = argv.join(' ');
			calls.push({ command, stdin });
			return failing.some((needle) => command.includes(needle))
				? { ok: false, stderr: GH_REFUSAL }
				: { ok: true, stderr: '' };
		};
		return { calls, run };
	}

	it('reports one plain line per applied change and exits 0 when every command succeeds', () => {
		const { commands } = planGithubSetup(READY);
		const { calls, run } = stubApplyRunner();

		const report = runSetupCommands({ commands, mode: 'auto', run });

		expect(calls.map((call) => call.command)).toEqual(
			commands.map((command) => command.argv.join(' '))
		);
		expect(report.stdout).toEqual(commands.map((command) => command.describe));
		expect(report.stderr).toEqual([]);
		expect(report.exitCode).toBe(0);
	});

	it('collapses a refused command to one calm line and exit 0 in auto mode', () => {
		// The `npm run setup` path. A wall of red from `gh` in the middle of bootstrap is a
		// product failure for the non-technical user this template is for: `auto` mode exists
		// so that everything unavailable in their environment degrades to one calm line.
		const { commands } = planGithubSetup(READY);
		const { run } = stubApplyRunner(['/rulesets']);

		const report = runSetupCommands({ commands, mode: 'auto', run });

		expect(report.exitCode).toBe(0);
		expect(report.stderr).toEqual([]);
		// One line for the change that DID land, one for the one that did not — and nothing
		// of gh's own complaint, which is what `npm run setup:github` is for.
		expect(report.stdout).toHaveLength(2);
		expect(report.stdout[0]).toBe(commands[1].describe);
		expect(report.stdout[1]).toMatch(/^Skipping GitHub settings: /);
		expect(report.stdout[1]).toContain('required checks');
		expect(report.stdout[1]).toContain('npm run setup:github');
		expect(report.stdout.join('\n')).not.toContain(GH_REFUSAL);
	});

	it('reports the same refusal loudly and non-zero in explicit mode', () => {
		// The contrast with the case above is the whole point of having two modes: `explicit`
		// is the command the user typed, so they get gh's real error and a failing exit code.
		// Swallowing it here would make `npm run setup:github` useless for diagnosis.
		const { commands } = planGithubSetup(READY);
		const { run } = stubApplyRunner(['/rulesets']);

		const report = runSetupCommands({ commands, mode: 'explicit', run });

		expect(report.exitCode).toBe(1);
		expect(report.stderr.join('\n')).toContain(GH_REFUSAL);
		expect(report.stderr.join('\n')).toContain('the required checks on the default branch');
		// Which command died, so the failure can be reproduced by hand.
		expect(report.stderr.join('\n')).toContain(commands[0].argv.join(' '));
		// The change that DID land is still reported, on stdout, exactly as when it all works.
		expect(report.stdout).toEqual([commands[1].describe]);
		expect(report.stdout.some((line) => line.startsWith('Skipping'))).toBe(false);
	});

	it('applies the remaining changes after one command is refused', () => {
		// Ruleset-first ordering used to mean a refused ruleset also lost the merge settings,
		// which GitHub accepts on ANY plan. Each command is independent and idempotent, so a
		// refusal stops that command and nothing else.
		const { commands } = planGithubSetup(READY);
		const { calls, run } = stubApplyRunner(['/rulesets']);

		for (const mode of ['auto', 'explicit']) {
			runSetupCommands({ commands, mode, run });
		}

		expect(calls.map((call) => call.command)).toEqual([
			commands[0].argv.join(' '),
			commands[1].argv.join(' '),
			commands[0].argv.join(' '),
			commands[1].argv.join(' '),
		]);
	});

	it('names every refused change when nothing at all could be applied', () => {
		const { commands } = planGithubSetup(READY);
		const { run } = stubApplyRunner(['gh api']);

		const report = runSetupCommands({ commands, mode: 'auto', run });

		expect(report.stdout).toHaveLength(1);
		for (const command of commands) {
			expect(report.stdout[0]).toContain(command.subject);
		}
	});
});

describe('isGithubOrigin', () => {
	it.each([
		// The maintainer's own remote: an SSH config alias host, NOT `github.com`. A
		// boundary-anchored host match rejects it and makes the whole script skip silently
		// on a repo that is very much on GitHub.
		'git@github.com-personal:semi-sentient/vibe-starter.git',
		'git@github.com:acme/my-app.git',
		'git@github.com:acme/my-app',
		'https://github.com/acme/my-app.git',
		'https://github.com/acme/my-app',
		'ssh://git@github.com/acme/my-app.git',
	])('accepts %s', (originUrl) => {
		expect(isGithubOrigin(originUrl)).toBe(true);
	});

	it.each([
		'git@gitlab.com:acme/my-app.git',
		'https://bitbucket.org/acme/my-app.git',
		'/srv/git/my-app.git',
		'',
	])('rejects %s', (originUrl) => {
		expect(isGithubOrigin(originUrl)).toBe(false);
	});

	it('rejects a missing origin without throwing', () => {
		// The gatherer resolves a failed `git remote get-url origin` to `null`.
		expect(isGithubOrigin(null)).toBe(false);
		expect(isGithubOrigin(undefined)).toBe(false);
	});
});

describe('extractCiJobNames', () => {
	// Job-level `name:` keys sit at exactly eight spaces in this Prettier-formatted
	// workflow; step names are deeper and `- ` prefixed. That indent IS the parser.
	const WORKFLOW = [
		'name: CI',
		'jobs:',
		'    build-and-test:',
		'        # REQUIRED-CHECK CONTRACT: referenced by the ruleset.',
		'        name: Build & test',
		'        runs-on: ubuntu-latest',
		'        steps:',
		'            - name: Checkout',
		'              uses: actions/checkout@v7',
		'            - name: Lint',
		'              run: npm run lint',
		'    cross-platform:',
		'        name: Cross-platform build (${{ matrix.os }})',
		'',
	].join('\n');

	it('reads job display names and ignores step names and comments', () => {
		expect(extractCiJobNames(WORKFLOW)).toEqual([
			'Build & test',
			'Cross-platform build (${{ matrix.os }})',
		]);
	});

	it('reads the same names from a CRLF checkout', () => {
		// Defence in depth, not a live need: this repository's `.gitattributes` pins `*.yml`
		// to `eol=lf`, so the template never sees CRLF here. A downstream repository owns
		// that file, and without the pin a Windows clone with `core.autocrlf=true` hands us
		// `Build & test\r`. Left in, the trailing carriage return makes every gate name
		// "missing" and the script skips with a message nobody can act on.
		expect(extractCiJobNames(WORKFLOW.replace(/\n/g, '\r\n'))).toEqual([
			'Build & test',
			'Cross-platform build (${{ matrix.os }})',
		]);
	});

	it('finds nothing in a workflow that has no job-level names', () => {
		expect(extractCiJobNames('jobs:\n    build:\n        runs-on: ubuntu-latest\n')).toEqual(
			[]
		);
	});

	itInTemplate('finds every gate check in this repo’s real CI workflow', () => {
		// The only thing coupling `GATE_CHECK_NAMES` to the workflow. Drift does not fail
		// loudly anywhere else: GitHub accepts a required check naming a context no job
		// produces, and every pull request then waits on it forever.
		//
		// Template-only: downstream the workflow is the user's and renaming or deleting a
		// job is their prerogative — `planGithubSetup` already refuses to apply the ruleset
		// in that state, which is the correct downstream behaviour, not a test failure.
		const names = extractCiJobNames(readFileSync(join(REPO_ROOT, CI_WORKFLOW_PATH), 'utf8'));

		expect(
			names,
			[
				'`GATE_CHECK_NAMES` in `scripts/setup-github.mjs` drifted from the job display',
				'names in `.github/workflows/ci.yml`. Those strings become required status',
				'checks: GitHub accepts a context that no job produces and then blocks every',
				'pull request on it forever. Either restore the job name in the workflow or',
				'update `GATE_CHECK_NAMES` — and keep the REQUIRED-CHECK CONTRACT comments in',
				'the workflow pointing at whichever names win.',
			].join(' ')
		).toEqual(expect.arrayContaining(GATE_CHECK_NAMES));

		// The templated matrix name is matched too, and is harmless: the rung asks whether
		// the gates are a SUBSET of the job names, never that the two lists are equal.
		expect(names).toContain('Cross-platform build (${{ matrix.os }})');
	});
});

describe('gatherSetupState', () => {
	/**
	 * A runner that answers each command by its joined argv, and records what it was
	 * asked. Anything not in `answers` resolves to `null` — the same "this command failed"
	 * value the real CLI produces from a non-zero exit.
	 */
	function stubRunner(answers) {
		const calls = [];
		const run = ({ argv }) => {
			calls.push(argv.join(' '));
			return Object.hasOwn(answers, argv.join(' ')) ? answers[argv.join(' ')] : null;
		};
		return { calls, run };
	}

	// The one gathering command whose argv is long enough to be worth naming: the query
	// string carries two decisions (`includes_parents=false`, `per_page=100`) that several
	// cases below assert on.
	const RULESETS_CALL =
		'gh api /repos/{owner}/{repo}/rulesets?includes_parents=false&per_page=100 --jq [.[] | {id, name}]';

	const HEALTHY = {
		'gh --version': 'gh version 2.62.0\n',
		'gh auth status': 'Logged in to github.com account someone\n',
		'git remote get-url origin': 'git@github.com-personal:semi-sentient/vibe-starter.git\n',
		'gh repo view --json viewerPermission': '{"viewerPermission":"ADMIN"}\n',
		[RULESETS_CALL]: '[{"id":4242,"name":"main-required-checks"}]\n',
	};

	const WORKFLOW = [
		'jobs:',
		'    build-and-test:',
		'        name: Build & test',
		'    gitleaks:',
		'        name: Secret scan',
		'    docker-smoke:',
		'        name: Docker smoke',
		'',
	].join('\n');

	it('runs every gathering command in ladder order and reads the workflow', () => {
		const { calls, run } = stubRunner(HEALTHY);
		const read = [];
		const readFile = (path) => {
			read.push(path);
			return WORKFLOW;
		};

		const state = gatherSetupState({ mode: 'explicit', readFile, run });

		expect(calls).toEqual([
			'gh --version',
			'gh auth status',
			'git remote get-url origin',
			'gh repo view --json viewerPermission',
			RULESETS_CALL,
		]);
		expect(read).toEqual([CI_WORKFLOW_PATH]);
		expect(state).toEqual({
			ciJobNames: ['Build & test', 'Secret scan', 'Docker smoke'],
			existingRulesets: [{ id: 4242, name: 'main-required-checks' }],
			ghAuthed: true,
			ghInstalled: true,
			mode: 'explicit',
			originIsGithub: true,
			viewerPermission: 'ADMIN',
		});
		// The gathered state is exactly what the decision core needs, nothing more.
		expect(planGithubSetup(state).action).toBe('apply');
	});

	it.each([
		{ after: 0, rung: 'gh is not installed', without: 'gh --version' },
		{ after: 1, rung: 'gh is not signed in', without: 'gh auth status' },
		{ after: 2, rung: 'there is no origin remote', without: 'git remote get-url origin' },
		{
			after: 3,
			rung: 'the user is not an admin',
			without: 'gh repo view --json viewerPermission',
		},
	])('stops gathering at the first unmet rung when $rung', ({ after, without }) => {
		// Every later command is a wasted call at best and a 403 at worst: an unauthenticated
		// `gh` fails all of them, and a non-admin is refused the rulesets read outright.
		const answers = { ...HEALTHY };
		delete answers[without];
		const { calls, run } = stubRunner(answers);
		let readCount = 0;

		gatherSetupState({
			mode: 'auto',
			readFile: () => {
				readCount += 1;
				return WORKFLOW;
			},
			run,
		});

		expect(calls).toHaveLength(after + 1);
		expect(calls.at(-1)).toBe(without);
		expect(readCount).toBe(0);
	});

	it('asks for a full page of rulesets rather than the default 30', () => {
		// The upsert matches by NAME, so a `main-required-checks` sitting past the page
		// boundary reads as absent and the next run POSTs a duplicate. Pagination stays
		// unhandled on purpose (see the module comment); raising the page cap 3.3× is free.
		const { calls, run } = stubRunner(HEALTHY);

		gatherSetupState({ mode: 'auto', readFile: () => WORKFLOW, run });

		expect(calls.at(-1)).toContain('&per_page=100');
	});

	it('reads only this repository’s own rulesets, never an inherited one', () => {
		// `GET /rulesets` defaults to `includes_parents=true`, which folds in org- and
		// enterprise-level rulesets. One of those named `main-required-checks` would match
		// the upsert by name, and its id would then be spliced into the REPO-scoped update
		// path — a 404 that fails `npm run setup:github` outright, and prints gh's complaint
		// mid-bootstrap. Only a ruleset this repository owns can be updated in place.
		const { calls, run } = stubRunner(HEALTHY);

		gatherSetupState({ mode: 'auto', readFile: () => WORKFLOW, run });

		expect(calls.at(-1)).toContain('/repos/{owner}/{repo}/rulesets?includes_parents=false');
	});

	it('stops before the rulesets read when a gate job is missing', () => {
		const { calls, run } = stubRunner(HEALTHY);

		const state = gatherSetupState({
			mode: 'auto',
			readFile: () => WORKFLOW.replace('        name: Docker smoke\n', ''),
			run,
		});

		expect(calls).not.toContain(RULESETS_CALL);
		expect(planGithubSetup(state).reason).toContain('`Docker smoke`');
	});

	it('never throws when every command and the workflow read fail', () => {
		// This is what `npm run setup` hits on a machine with no `gh`. A throw here is a
		// stack trace in the middle of bootstrap instead of one skip line.
		const state = gatherSetupState({ mode: 'auto', readFile: () => null, run: () => null });

		expect(state.ghInstalled).toBe(false);
		expect(planGithubSetup(state).action).toBe('skip');
	});

	it('treats unparseable gh output as an unknown permission rather than throwing', () => {
		// `gh` can answer 0 with something that is not the JSON we asked for (a broken alias,
		// an extension printing a banner). That must read as "not an admin", not as a crash.
		const { run } = stubRunner({ ...HEALTHY, 'gh repo view --json viewerPermission': 'huh?' });

		const state = gatherSetupState({ mode: 'auto', readFile: () => WORKFLOW, run });

		expect(state.viewerPermission).toBeNull();
		expect(planGithubSetup(state).reason).toContain('admin access');
	});

	it('ignores a ruleset entry with no usable id', () => {
		// The id is spliced straight into the PUT path. An entry that cannot supply one has
		// to be dropped, or the update goes to `/rulesets/undefined`.
		const { run } = stubRunner({
			...HEALTHY,
			[RULESETS_CALL]: '[{"name":"main-required-checks"}]',
		});

		const state = gatherSetupState({ mode: 'auto', readFile: () => WORKFLOW, run });

		expect(state.existingRulesets).toEqual([]);
		expect(planGithubSetup(state).commands[0].argv).not.toContain(
			'/repos/{owner}/{repo}/rulesets/undefined'
		);
	});

	it('treats an unparseable rulesets response as no rulesets', () => {
		const { run } = stubRunner({ ...HEALTHY, [RULESETS_CALL]: 'not json' });

		const state = gatherSetupState({ mode: 'auto', readFile: () => WORKFLOW, run });

		expect(state.existingRulesets).toEqual([]);
		// Falling back to "none" means a re-run POSTs a duplicate rather than updating —
		// noisy but recoverable, where guessing an id would overwrite someone else's ruleset.
		expect(planGithubSetup(state).commands[0].argv).toContain('POST');
	});
});

describe('parseMode', () => {
	it('is explicit only when --explicit is passed', () => {
		expect(parseMode(['--explicit'])).toBe('explicit');
		expect(parseMode([])).toBe('auto');
		expect(parseMode(['--quiet'])).toBe('auto');
	});
});

describe('the setup-github CLI', () => {
	// Every case below runs a COPY of the script from a throwaway directory, with `PATH`
	// pointing at a directory this suite owns. Nothing it spawns can resolve to the real
	// `gh`/`git`, and its `cwd` is not a git repository — so no case can reach, or change,
	// the repository the suite is running in. That is deliberate: this script's whole job
	// is mutating GitHub settings.
	let sandbox;

	beforeEach(() => {
		sandbox = mkdtempSync(join(tmpdir(), 'setup-github-cli-'));
		mkdirSync(join(sandbox, 'bin'));
		mkdirSync(join(sandbox, 'scripts'));
		cpSync(
			fileURLToPath(new URL('./setup-github.mjs', import.meta.url)),
			join(sandbox, 'scripts', 'setup-github.mjs')
		);
	});

	afterEach(() => {
		rmSync(sandbox, { force: true, recursive: true });
	});

	/**
	 * Run the copied script with only the sandbox `bin` on `PATH`.
	 *
	 * The rest of `process.env` is inherited on purpose. `PATH` is the whole of the
	 * isolation — a `gh` or `git` that cannot be resolved cannot be run, and every case here
	 * either supplies its own stub or supplies none — while the environment a spawned
	 * `node` needs is host-specific: win32 wants `SystemRoot`/`COMSPEC`/`windir`, and a
	 * hand-built `{ PATH }` would leave a Windows run failing for a reason that has nothing
	 * to do with this script. `GH_*`/`GITHUB_*` are dropped anyway: nothing here can reach
	 * an API, but a token in the environment of a process whose job is mutating GitHub
	 * settings is not something to leave to reasoning about reachability. (CI sets several —
	 * `GITHUB_TOKEN`, `GITHUB_REPOSITORY` — so this is not hypothetical.)
	 */
	function runCli(argv = []) {
		const env = {
			...process.env,
			PATH: join(sandbox, 'bin'),
			RECORD: join(sandbox, 'calls.txt'),
		};
		for (const key of Object.keys(env)) {
			if (key.startsWith('GH_') || key.startsWith('GITHUB_')) delete env[key];
		}

		return spawnSync(
			process.execPath,
			[join(sandbox, 'scripts', 'setup-github.mjs'), ...argv],
			{
				cwd: sandbox,
				encoding: 'utf8',
				env,
			}
		);
	}

	/** Install an executable stand-in for a real binary in the sandbox `bin`. */
	function stub(name, script) {
		const path = join(sandbox, 'bin', name);
		writeFileSync(path, script, { mode: 0o755 });
	}

	/**
	 * Skipped on Windows, deliberately — NOT neglect, and not a gap worth closing.
	 *
	 * {@link stub} writes extensionless `#!/bin/sh` files, which win32 cannot resolve: it
	 * finds an executable by PATHEXT. The only executable text a test could write instead is
	 * a `.cmd`/`.bat`, and `execFileSync` refuses to spawn one of those without
	 * `shell: true` (the CVE-2024-27980 fix, Node ≥18.20.2/20.12.2 — the same wall
	 * `release.mjs` hit). The stub would still be unreachable, and making it reachable would
	 * mean loosening the real module to suit a test. A `.exe` needs a dependency `scripts/**`
	 * deliberately does not have.
	 *
	 * It must SKIP rather than fail: this file ships downstream and a Windows user runs it
	 * on every commit (pre-commit → `npm run build:validate` → `vitest`), while CI's
	 * `Cross-platform build` job has no test step that would redden first. `release.mjs`
	 * shows the alternative where one exists — pin the win32 shape by parameterising
	 * `platform` instead of spawning. There is nothing here to parameterise: what this case
	 * proves is that `--input -` really delivers a body to a real child process, which only
	 * a spawn can show. Every other case in this suite is platform-independent and runs
	 * everywhere.
	 */
	const itOnPosix = it.skipIf(process.platform === 'win32');

	it('prints one skip line and exits 0 when gh is missing', () => {
		// The `npm run setup` path on a machine with no `gh`. `bootstrap.sh` runs under
		// `set -euo pipefail`, and this is the behaviour the `|| true` there is a backstop
		// for, not a substitute for.
		const result = runCli();

		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
		expect(result.stdout).toContain('gh');
		// A gathering failure is an answer, so nothing may leak onto stderr — not the
		// spawn error, not gh's own complaint.
		expect(result.stderr).toBe('');
	});

	it('exits non-zero with an actionable message when asked for explicitly', () => {
		const result = runCli(['--explicit']);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('https://cli.github.com');
	});

	/**
	 * A sandbox where every precondition is met: stub `git` and `gh`, plus a `ci.yml` naming
	 * all three gates. With `refuseRuleset`, the stub `gh` answers the ruleset write the way
	 * a private repo on the GitHub Free plan does — non-zero, with its own words on stderr.
	 */
	function stubReadyRepo({ refuseRuleset = false } = {}) {
		stub('git', ['#!/bin/sh', 'echo "git@github.com:acme/my-app.git"', ''].join('\n'));
		stub(
			'gh',
			[
				'#!/bin/sh',
				'case "$1" in',
				'  --version) echo "gh version 0.0.0"; exit 0 ;;',
				'  auth) echo "Logged in to github.com"; exit 0 ;;',
				'  repo) echo \'{"viewerPermission":"ADMIN"}\'; exit 0 ;;',
				'esac',
				'if [ "$2" = "--method" ]; then',
				'  printf "CALL %s\\n" "$*" >>"$RECORD"',
				// Shell builtins only: `PATH` holds nothing but these stubs, so even `cat`
				// is unavailable — which is itself the proof that this sandbox cannot reach
				// a real `gh`. The `|| [ -n "$line" ]` tail catches a final line with no
				// trailing newline, which is exactly what `JSON.stringify` produces.
				'  while IFS= read -r line || [ -n "$line" ]; do',
				'    printf "%s\\n" "$line" >>"$RECORD"',
				'  done',
				// Read stdin BEFORE failing: a child that exits without draining `--input -`
				// leaves the parent writing to a closed pipe.
				...(refuseRuleset
					? [
							'  case "$*" in',
							`    *rulesets*) echo "${GH_REFUSAL}" >&2; exit 1 ;;`,
							'  esac',
						]
					: []),
				'  echo "{}"',
				'  exit 0',
				'fi',
				'echo "[]"',
				'',
			].join('\n')
		);
		mkdirSync(join(sandbox, '.github', 'workflows'), { recursive: true });
		writeFileSync(
			join(sandbox, CI_WORKFLOW_PATH),
			['jobs:', ...GATE_CHECK_NAMES.map((name) => `        name: ${name}`), ''].join('\n')
		);
	}

	itOnPosix('sends each payload on stdin and reports one line per change', () => {
		// Fully stubbed executors — see the note at the top of this block, and
		// {@link itOnPosix} for why Windows sits this one out.
		stubReadyRepo();

		const result = runCli(['--explicit']);

		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split('\n')).toHaveLength(2);

		const calls = readFileSync(join(sandbox, 'calls.txt'), 'utf8');
		expect(calls).toContain('CALL api --method POST /repos/{owner}/{repo}/rulesets --input -');
		expect(calls).toContain('CALL api --method PATCH /repos/{owner}/{repo} --input -');
		// The bodies really arrive on stdin — the whole reason for `--input -`.
		const bodies = calls
			.split('\n')
			.filter((line) => line.startsWith('{'))
			.map((line) => JSON.parse(line));
		expect(bodies).toEqual([
			EXPECTED_RULESET,
			{ allow_auto_merge: true, delete_branch_on_merge: true },
		]);
	});

	itOnPosix('stays quiet and exits 0 when GitHub refuses a change during `npm run setup`', () => {
		// The likeliest downstream shape of all: an admin of a PRIVATE repo on the Free plan,
		// where rulesets are a paid feature. Inside bootstrap that must read as one calm line,
		// not as gh's stderr dumped mid-run — `bootstrap.sh`'s `|| true` rescues the exit code
		// but nothing rescues the noise.
		stubReadyRepo({ refuseRuleset: true });

		const result = runCli();

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
		// The merge settings landed — they need no paid plan — and the ruleset is named as
		// the one thing that did not.
		const lines = result.stdout.trimEnd().split('\n');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('auto-merge');
		expect(lines[1]).toMatch(/^Skipping GitHub settings: /);
		expect(result.stdout).not.toContain('403');
	});

	itOnPosix('surfaces the refusal and exits non-zero when asked for explicitly', () => {
		// Same sandbox, same refusal, opposite contract: `npm run setup:github` is the command
		// the user typed, so gh's own error and a failing exit code are what they asked for.
		stubReadyRepo({ refuseRuleset: true });

		const result = runCli(['--explicit']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(GH_REFUSAL);
		expect(result.stderr).toContain('the required checks on the default branch');
		// The merge settings still applied, and still say so on stdout.
		expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
		expect(result.stdout).toContain('auto-merge');
	});
});
