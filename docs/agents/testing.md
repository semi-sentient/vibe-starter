# Testing Patterns

Project-specific harness rules and gotchas. Generic testing-library/Vitest API knowledge is assumed.

## Two Vitest projects (`vitest.config.ts`)

- **`web`** — `src/web/**`. Environment is **happy-dom, not jsdom** — some DOM behavior differs, so don't assume jsdom quirks. jest-dom + MSW are wired into the web test setup.
- **`server`** — `src/server/**`, `src/auth/**`, `src/payments/**`. Node env, **DB-backed** against a real test Postgres.

Non-obvious config facts (the WHY, since the file is readable):

- **Serial execution is mandatory:** `fileParallelism: false` + `maxWorkers: 1`. All DB tests share one test database (`vibe_starter_test`), so they must never run concurrently. Don't "speed up" the suite by re-enabling parallelism.
- The shared DB is created + migrated once in `globalSetup` using the **programmatic migrator only — never drizzle-kit** (drizzle-kit auto-loads `.env` and would migrate the DEV db).
- **Coverage is not configured.** If you add it: v8 provider + `/* v8 ignore start|next */`. Istanbul-style comments do **not** work with v8.

## Server (DB-backed) harness

Server tests run the real Hono app against the test Postgres. Helpers live in `src/server/test/helpers/`:

```typescript
const server = createTestServer();
await loginAs(server, 'person@example.com'); // authenticated cookie
const res = await server.request('/api/orders'); // request-able app
```

- DB is reset before each test (`resetDb`) — start from a known empty state.
- **Seed via factories** in `src/server/test/factories/` (`createUser`, `createOrder`), not hand-written insert objects.
- Full pattern (auth gating, ownership rule, 404 guards): the `orders.routes.test.ts` suite.

## Factory-reuse rule

Before writing any inline mock/seed object, check the server factories (`src/server/test/factories/`) and the web test helpers (`src/web/test/`) for an existing one and reuse it. New factories follow the established shape: sensible defaults + `Partial<...>` overrides, returning the full entity.

## Network mocking: MSW only

The `web` project has an MSW server wired into the test lifecycle. Override per-test with `server.use(http.post(...))`. **Never** hand-stub `fetch` or the RPC client.

For mock/spy types use **Vitest 4** forms: `Mock<...>` and `MockInstance` — not `ReturnType<typeof vi.fn>`.

## Web interaction + assertion conventions

- Use `@testing-library/user-event` with `userEvent.setup()` before render; `fireEvent` is the escape hatch only. Migrate stray `fireEvent` to `userEvent` when you touch a test.

    ```typescript
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'person@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    ```

- Selector priority: `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByTestId` (last resort).
- **No i18n** — assert on literal visible copy, not translation keys.
- Test-id format when semantic queries can't reach an element: `ComponentName-ElementDescription` (e.g. `Layout-Nav`).

## Conventions

- Co-locate `.test.ts(x)` next to source. **Exception:** cross-cutting whole-system anchor suites (migration-chain checks, multi-route access-control) live in `src/server/__tests__/` — that directory is their sanctioned home.
- Outermost `describe` names the unit: components `<Name />`, routes `METHOD /api/path`, modules/functions by name. Max 2 nesting levels; name tests `'<behavior> when <condition>'`.
- Prefer TDD (red-green-refactor) for features/bugfixes/refactors via the **tdd** skill; skip for trivial/config-only edits.

## Reference tests (grep the name)

- Component + form: `Login.test.tsx`
- Route / API contract: `orders.routes.test.ts`
- Module unit: `csrf.test.ts`
  </content>
