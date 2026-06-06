# Web Testing (side-specific)

Canonical rules live in [`/docs/agents/testing.md`](../../../../docs/agents/testing.md) — read it first. This file is the web quick-reference only; it does not restate the harness rules.

## Where things are

- **Test setup + MSW:** `src/web/test/` — `setup.ts` (jest-dom + MSW lifecycle wiring) and `msw-server.ts` (exports the MSW `server`). Override a handler per-test with `server.use(http.post(...))`.
- **Tests co-locate** next to the component/hook/module they cover.

## Side-specific facts

- **Environment is happy-dom, not jsdom** — don't assume jsdom-only quirks.
- **Interactions: `@testing-library/user-event`.** `const user = userEvent.setup()` before render; `fireEvent` is the escape hatch only. Selector priority: `getByRole` > `getByLabelText` > `getByPlaceholderText` > `getByText` > `getByTestId`.
- **When to mock:** network only, via MSW — **never** hand-stub `fetch` or the Hono RPC `client`. Render real components with real providers.
- **What to test:** user-visible behavior (rendered copy, role-based queries, form submit → request), not implementation details. No i18n — assert literal copy. Reference: `Login.test.tsx`.

## Naming

Outermost `describe` is `<Name />`; tests read `'<behavior> when <condition>'`. Prefer TDD via the **tdd** skill for new components/bugfixes.
