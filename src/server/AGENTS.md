# Server — Agent Instructions

The root [`/AGENTS.md`](../../AGENTS.md) governs everything; this file only adds server-side pointers. Read the root file first.

Server code is the Hono app, DB schema/migrations, and the auth/payments modules (`src/server/**`, `src/auth/**`, `src/payments/**`, `src/db/**`).

## Read first, by task

- **Access control / protected routes / user-owned data** — the [`auth`](../../.agents/skills/auth/SKILL.md) skill (the ownership rule, `requireAuth`/`requireRole`, CSRF, `rateLimit`). The single highest-stakes contract here.
- **API / network-boundary types** — [`/docs/agents/documentation.md`](../../docs/agents/documentation.md) (wire type ≠ DB type; per-field TSDoc).
- **External calls / MCP** — [`/docs/agents/mcp-usage.md`](../../docs/agents/mcp-usage.md).
- **Tests** — [`./docs/agents/testing.md`](./docs/agents/testing.md) (DB harness, factories), atop the canonical [`/docs/agents/testing.md`](../../docs/agents/testing.md).

## Server non-negotiables

- New behavior/bugfixes: red-green-refactor via the **tdd** skill.
- Adding/reading user-owned rows: apply the ownership rule (404, never 403) — do not improvise it.
- New env var: update the zod schema in `src/env.ts` **and** `.env.example` in the same change (see root `AGENTS.md`).
