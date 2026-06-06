# Vibe Starter - Agent Instructions

## Non-Negotiables

1. Surface assumptions as they arise. Wrong assumptions held silently are the most common failure mode.
2. Stop and ask when requirements conflict. Don’t guess.
3. Push back when you disagree. The agent (or engineer) is not a yes-machine.
4. Prefer the boring, obvious solution. Cleverness is expensive.
5. Touch only what you’re asked to touch.

## Quality Expectations

This codebase will outlive you. Every shortcut you take becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down. You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again. Fight entropy.

## Coding Standards

**No Barrel Exports** — Import from source files directly (`./Foo.tsx`), not `index.ts`.
**Formatting** — Sort alphabetically: imports, exports, object keys, JSON keys, destructured props.
**File Naming** — PascalCase (`UserSettings.tsx`) for components; camelCase with `use` prefix (`useUserSettings.ts`) for hooks; kebab-case (`date-formatters.ts`) for modules; tests add `.test` before extension.
**TypeScript** — Never `any` (use `unknown`); `interface` > `type` for entities; `as const` > `enum`.
**Environment Variables** — Env grows in lockstep: every new variable updates the zod schema in `src/env.ts` **and** `.env.example` in the same change (the schema makes config fail loudly; `.env.example` is the contract for the next dev). Read env via the validated `env` export, never `process.env` directly.
**Vendored Code** — Files emitted by an external CLI (notably shadcn/ui output under `src/web/components/ui/`) are third-party. Leave them as the tool generates them — they're exempt from the naming, alphabetical-ordering, return-type, and documentation conventions above, so the CLI can update them in place. Restyle via theme tokens (see `docs/agents/ui-components.md`); don't hand-edit.
**Priority Order** — When guidelines conflict: 1. Type safety → 2. User experience → 3. Maintainability → 4. Test coverage → 5. Formatting

## Topic Documentation

Before planning or writing code, check the table below. If your task matches a row, read that documentation file first. Only read files relevant to the current task.

| When task involves…                                                                   | Documentation                   |
| ------------------------------------------------------------------------------------- | ------------------------------- |
| Creating or modifying any source file (inline comments, JSDoc, public-interface docs) | `docs/agents/documentation.md`  |
| Creating or modifying components, custom hooks, or context providers                  | `docs/agents/react-patterns.md` |
| Writing or updating unit tests                                                        | `docs/agents/testing.md`        |
| Styling, layout, theming, Tailwind/shadcn usage, or any component with JSX            | `docs/agents/ui-components.md`  |
| Calling external APIs or using MCP server tools                                       | `docs/agents/mcp-usage.md`      |

For architecture and the rationale behind the locked decisions (stack, auth model, access-control contract, payments shape, tooling), the design docs load on demand — read the relevant one before a structural change or when a decision's _why_ matters: [`docs/design/PROJECT_DESIGN.md`](docs/design/PROJECT_DESIGN.md), [`docs/design/BACKEND_DESIGN.md`](docs/design/BACKEND_DESIGN.md), [`docs/design/FRONTEND_DESIGN.md`](docs/design/FRONTEND_DESIGN.md), [`docs/design/TOOLING_DESIGN.md`](docs/design/TOOLING_DESIGN.md). Per-side notes live in [`src/server/AGENTS.md`](src/server/AGENTS.md) and [`src/web/AGENTS.md`](src/web/AGENTS.md).

## Plan Mode

- Write plans to `.agents/plans/{name}.md` where `{name}` is a short, descriptive kebab-case name derived from the feature/task (e.g. `persist-data-grid-state.md`, `fix-annotation-z-index.md`). NEVER use random/generated names.
- Before creating a plan: run `grill-with-docs` first to resolve open design questions (it captures terminology decisions to `CONTEXT.md` and offers ADRs inline). Skip if a grilling session — either `grill-with-docs` or `grill-me` — has already run for this topic in the current conversation.
- If the plan involves new code, bug fixes, or refactors, read the `tdd` skill and incorporate its workflow.
- Keep plans concise but encode all resolved decisions. Each step should include enough context (what, where, why, constraints) that the coding agent can execute without ambiguity. Use terse phrasing — fragments and shorthand are fine — but don't omit implementation-relevant details.
- End each plan with a list of unresolved questions, if any.
- Skills accumulate reactively, not speculatively: write a new skill only once a pattern has actually recurred or a failure mode has appeared (the shipped `auth` skill is the sole exception — the day-one access-control contract). Don't pre-author skills for libraries/patterns you merely anticipate.

## Temporary Artifacts

Write all temporary files (diffs, intermediate JSON, scraped output, scratch greps) to `.agents/scratch/`, never `/tmp/`. The directory is gitignored and `Write`/`Edit` there is pre-approved.
