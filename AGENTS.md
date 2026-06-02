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
**Priority Order** — When guidelines conflict: 1. Type safety → 2. User experience → 3. Maintainability → 4. Test coverage → 5. Formatting

## Plan Mode

- Write plans to `.agents/plans/{name}.md` where `{name}` is a short, descriptive kebab-case name derived from the feature/task (e.g. `persist-data-grid-state.md`, `fix-annotation-z-index.md`). NEVER use random/generated names.
- Before creating a plan: run `grill-with-docs` first to resolve open design questions (it captures terminology decisions to `CONTEXT.md` and offers ADRs inline). Skip if a grilling session — either `grill-with-docs` or `grill-me` — has already run for this topic in the current conversation.
- If the plan involves new code, bug fixes, or refactors, read the `tdd` skill and incorporate its workflow.
- Keep plans concise but encode all resolved decisions. Each step should include enough context (what, where, why, constraints) that the coding agent can execute without ambiguity. Use terse phrasing — fragments and shorthand are fine — but don't omit implementation-relevant details.
- End each plan with a list of unresolved questions, if any.

## Temporary Artifacts

Write all temporary files (diffs, intermediate JSON, scraped output, scratch greps) to `.agents/scratch/`, never `/tmp/`. The directory is gitignored and `Write`/`Edit` there is pre-approved.
