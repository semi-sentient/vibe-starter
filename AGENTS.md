# Vibe Starter - Agent Instructions

## Non-Negotiables

1. Surface assumptions as they arise. Wrong assumptions held silently are the most common failure mode.
2. Stop and ask when requirements conflict. Don’t guess.
3. Push back when you disagree. The agent (or engineer) is not a yes-machine.
4. Prefer the boring, obvious solution. Cleverness is expensive.
5. Touch only what you’re asked to touch.

## Quality Expectations

This codebase will outlive you. Every shortcut you take becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down. You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again. Fight entropy.

## Communicating With the User

Match explanations and questions to the user's demonstrated level — infer it from their words, don't assume (models skew to expert-level by default, so correct toward the user's actual level). With an engineer, use precise terms and skip the hand-holding; with a non-technical user, translate. Recalibrate each turn — responding _below_ someone's level frustrates as much as above it. When the user reads as non-technical, follow [`docs/agents/communicating-with-users.md`](docs/agents/communicating-with-users.md); it matters most inside the interview skills (`grill-*`, `write-a-prd`, `prd-to-plan`, `prototype`) — keep their rigor, soften their delivery.

## Coding Standards

**No Barrel Exports** — Import from source files directly (`./Foo.tsx`), not `index.ts`.
**Formatting** — Sort alphabetically: imports, exports, object keys, JSON keys, destructured props.
**File Naming** — PascalCase (`UserSettings.tsx`) for components; camelCase with `use` prefix (`useUserSettings.ts`) for hooks; kebab-case (`date-formatters.ts`) for modules; tests add `.test` before extension.
**TypeScript** — Never `any` (use `unknown`); `interface` > `type` for entities; `as const` > `enum`.
**Environment Variables** — Env grows in lockstep. Every new env var updates three files in the same change: the zod schema (`src/env.ts`, or `src/env.client.ts` for `VITE_*`), `.env.example`, and `.env.test`. The schema makes config fail loudly at boot, `.env.example` is the contract for the next dev, and `.env.test` keeps the suite booting. In `.env.example` a platform-injected variable may ship **commented out** (as `RAILWAY_GIT_COMMIT_SHA` does) — documented there is what counts, not set there. Read env via the validated `env` export, never `process.env` directly.
**Vendored Code** — Files emitted by an external CLI (notably shadcn/ui output under `src/web/components/ui/`) are third-party. Leave them as the tool generates them — they're exempt from the naming, alphabetical-ordering, return-type, and documentation conventions above, so the CLI can update them in place. Restyle via theme tokens (see `docs/agents/ui-components.md`); don't hand-edit.
**Priority Order** — When guidelines conflict: 1. Type safety → 2. User experience → 3. Maintainability → 4. Test coverage → 5. Formatting

## Task Completion

Run `npm run build:validate` after **every set of code changes** (chains tsc → eslint → vitest). Fix failures before completing.

## Shipping

Shipping is the loop from a finished change to it running live in front of the user. The agent owns the whole loop; the user's part is looking at the app and saying go. Report in plain language throughout (see [`docs/agents/communicating-with-users.md`](docs/agents/communicating-with-users.md)). Operational detail — Railway, GitHub settings, the go-live checklist — lives in the [deploy runbook](DEPLOY.md); send the user there instead of restating it here.

**The publish loop**, in order:

1. **Local review first.** Run `npm run dev`, tell the user what to look at, and wait for their explicit go-ahead. Never publish on inferred consent. CI proves the app builds, boots, and passes its tests — it cannot see that something looks wrong.
2. **Branch, then commit.** Never commit to `main` directly. Use the `commit` skill for each commit: its Conventional Commits messages are what `npm run release` later reads to build the changelog.
3. **Open the PR** with `gh pr create`, under the user's own `gh` auth. Never ask them for a token.
4. **Watch the checks:** `gh pr checks <n> --watch`.
5. **Merge it yourself once green:** `gh pr merge <n> --merge`. Watch-and-merge is the contract. GitHub auto-merge may be enabled on the repo (`npm run setup:github` turns it on, if anyone has run it), but it is a **human** escape hatch in the UI — never hand the merge off to it and call the job done.
6. **Verify what is actually live.** Read the merge commit with `gh pr view <n> --json mergeCommitOid --jq .mergeCommitOid`, then poll `<origin>/api/health` until its `sha` field equals the first 7 characters of that SHA. Bound the poll at **20 attempts, 15 seconds apart** (5 minutes); if it never matches, say so plainly and point at the Railway deploy logs — never round a timeout up to success. `sha` is `null`, not absent, until a deploy reports one; treat `null` as "not live yet", not as a mismatch.
7. **Report** what shipped, where it is live (the URL), and how to undo it — three plain sentences, not a transcript.

**The live URL comes from `PUBLIC_APP_URL` in `.env`.** It is deliberately **not** in the zod schema — it is agent metadata, not app config, so a missing value can never fail the app's boot; `.env.example` ships it commented out. Ask the user for their live URL on the first publish and record it there. If no origin is known, say so, **skip step 6's poll**, and report the merge as done-but-unverified.

**Red CI, red `main`.** Never hand back a non-green PR — a failing check is the agent's problem to diagnose and fix, not the user's to decipher; translate it ("the test covering sign-in is failing"), fix it, push, watch again. If `main` itself goes red, revert the offending commit (`git revert <sha>`) and land the revert through a PR exactly as **Rollback** below describes, tell the user the previous version is back, then fix forward on a branch.

**Env-var gate.** A change that adds a **required** env var is not merged until the user has been told the exact variable name and value to set in Railway, on which service, and has confirmed they did it (the env table in [`DEPLOY.md`](DEPLOY.md#environment-variables) is the reference). Merging ahead of that takes production down at the next deploy — `src/env.ts` fails the boot on purpose. The alternative that needs no gate: make the variable optional with a safe default.

**Rollback.** "Go back to the version before X" means `git revert` the commit(s) and ship the revert through the loop above — branch, PR, green checks, merge. Never push a revert straight to `main`: it is a brand-new commit with no check runs on it, so wherever the `main-required-checks` ruleset is installed the required checks refuse it — and the PR path is the right one on repos that have not installed it yet. Both services redeploy from the merge commit, so they stay coherent. Never force-push `main` — a revert is itself revertible, a rewritten history is not. Reverting code does **not** undo a database migration, so if the change included one, say so and ask before reverting. Railway's per-service redeploy is the manual fallback; that path is in [`DEPLOY.md`](DEPLOY.md).

**Dependabot.** Its PRs are ordinary PRs: watch, merge on green, mention it in passing. Do not merge silently when the bump is a major version, the checks are red, or the diff reaches auth or payments — flag those to the user instead.

**Cutting a release (mostly a template-maintainer job).** "Cut a release" → `npm run release`, then report the new version and a one-line summary of what changed. If it refuses — dirty tree, wrong branch, nothing releasable — read the reason back to the user rather than working around it. An app built _from_ the template rarely needs this, but the tooling ships downstream and works there: with no `vX.Y.Z` tag on the repo yet, the first release seeds at `v0.1.0`.

## Topic Documentation

Before planning or writing code, check the table below. If your task matches a row, read that documentation file first. Only read files relevant to the current task.

| When task involves…                                                                   | Documentation                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------- |
| Creating or modifying any source file (inline comments, JSDoc, public-interface docs) | `docs/agents/documentation.md`            |
| Creating or modifying components, custom hooks, or context providers                  | `docs/agents/react-patterns.md`           |
| Writing or updating unit tests                                                        | `docs/agents/testing.md`                  |
| Styling, layout, theming, Tailwind/shadcn usage, or any component with JSX            | `docs/agents/ui-components.md`            |
| Calling external APIs or using MCP server tools                                       | `docs/agents/mcp-usage.md`                |
| Interviewing the user, asking clarifying questions, or any interactive skill          | `docs/agents/communicating-with-users.md` |

## Architecture & Locked Decisions

The rationale behind the locked decisions loads on demand — read the relevant design doc before a structural change or when a decision's _why_ matters: [`docs/design/PROJECT_DESIGN.md`](docs/design/PROJECT_DESIGN.md) (goals, scope, non-goals) and [`docs/design/TOOLING_DESIGN.md`](docs/design/TOOLING_DESIGN.md) (TypeScript/lint/test choices, the `AGENTS.md` protocol). Backend and frontend rationale lives with the code — see [`src/server/AGENTS.md`](src/server/AGENTS.md) and [`src/web/AGENTS.md`](src/web/AGENTS.md).

## Plan Mode

- Write plans to `.agents/plans/{name}.md` where `{name}` is a short, descriptive kebab-case name derived from the feature/task (e.g. `persist-data-grid-state.md`, `fix-annotation-z-index.md`). NEVER use random/generated names.
- Before creating a plan: run `grill-with-docs` first to resolve open design questions (it captures terminology decisions to `CONTEXT.md` and offers ADRs inline). Skip if a grilling session — either `grill-with-docs` or `grill-me` — has already run for this topic in the current conversation.
- If the plan involves new code, bug fixes, or refactors, read the `tdd` skill and incorporate its workflow.
- Keep plans concise but encode all resolved decisions. Each step should include enough context (what, where, why, constraints) that the coding agent can execute without ambiguity. Use terse phrasing — fragments and shorthand are fine — but don't omit implementation-relevant details.
- End each plan with a list of unresolved questions, if any.
- Skills accumulate reactively, not speculatively: write a new skill only once a pattern has actually recurred or a failure mode has appeared (the shipped `auth` skill is the sole exception — the day-one access-control contract). Don't pre-author skills for libraries/patterns you merely anticipate.

## Temporary Artifacts

Write all temporary files (diffs, intermediate JSON, scraped output, scratch greps) to `.agents/scratch/`, never `/tmp/`. The directory is gitignored and `Write`/`Edit` there is pre-approved.
