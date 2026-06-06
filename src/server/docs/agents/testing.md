# Server Testing (side-specific)

Canonical rules live in [`/docs/agents/testing.md`](../../../../docs/agents/testing.md) — read it first. This file is the server quick-reference only; it does not restate the harness rules.

## Where things are

- **Factories:** `src/server/test/factories/` — `createUser(overrides?)`, `setupUsers()` (returns `{ admin, user }`), `createOrder(...)`. Reuse these; never hand-write insert objects.
- **Harness helpers:** `src/server/test/helpers/` — `createTestServer()` (real Hono app, request-able), `loginAs(server, email)` (authenticated cookie), `resetDb()` (called before each test).
- **Anchor suites:** `src/server/__tests__/` — cross-cutting whole-system tests (`access-control.test.ts`, `migrations.test.ts`). Per-route tests co-locate next to source.

## Side-specific facts

- **DB-backed + serial.** Tests hit the real `vibe_starter_test` Postgres, shared across the suite — so serial execution is mandatory (see canonical doc); start from the empty state `resetDb()` leaves.
- **When to mock:** don't mock the DB or the app — exercise the real Hono app against the test Postgres. Mock only true externals (e.g. the email/Stripe boundary), and seed via factories.
- **What to test:** the route contract (status + body), auth gating (401/403), and the ownership rule (a non-owner gets **404, never 403**). Copy `orders.routes.test.ts` and the `access-control.test.ts` anchor when adding a user-owned resource — see the [`auth`](../../../../.agents/skills/auth/SKILL.md) skill.

## Naming

Outermost `describe` is `METHOD /api/path`; tests read `'<behavior> when <condition>'`. Prefer TDD via the **tdd** skill for new routes/bugfixes.
