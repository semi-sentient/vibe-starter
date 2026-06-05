# Web — Agent Instructions

The root [`/AGENTS.md`](../../AGENTS.md) governs everything; this file only adds web-side pointers. Read the root file first.

Web code is the Vite + React client (`src/web/**`).

## Read first, by task

- **Components, hooks, context, data fetching** — [`/docs/agents/react-patterns.md`](../../docs/agents/react-patterns.md) (`isPending` gating, named-export lazy wrapper, `<Context value>`, the typed Hono RPC `client`, provider order).
- **Styling / Tailwind / shadcn / theming** — [`/docs/agents/ui-components.md`](../../docs/agents/ui-components.md) (theme tokens only — incl. `success`/`warning`; no raw palette classes; vendored `components/ui/` is exempt).
- **Source-file docs** — [`/docs/agents/documentation.md`](../../docs/agents/documentation.md).
- **Tests** — [`./docs/agents/testing.md`](./docs/agents/testing.md) (RTL + `@testing-library/user-event`, MSW, happy-dom), atop the canonical [`/docs/agents/testing.md`](../../docs/agents/testing.md).

## Web non-negotiables

- New behavior/bugfixes: red-green-refactor via the **tdd** skill.
- Style only from semantic theme tokens; the bracketed-arbitrary-value lint won't catch raw palette classes (`text-green-700`) — self-enforce.
- The shipped `ErrorBoundary` catches render errors only — not async, event-handler, or `useEffect` errors (see root `AGENTS.md`). Handle those at the call site (TanStack Query covers data-fetch errors).
