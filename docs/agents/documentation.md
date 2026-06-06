# Documentation

## Override notice

Your default is to skip comments/JSDoc unless logic is non-obvious. **This project overrides that for the cases below.** Public interfaces, API/network-boundary types, and non-obvious gotchas REQUIRE docs as part of "complete."

Still skip: self-explanatory code, restating types (`/** the name */ name: string`), deferred TODOs (do it now), and commented-out code (delete it).

## Three tiers of required docs

- **Tier 1 — API / network-boundary types** (HTTP payloads, persisted-row shapes the client sees): interface summary AND per-field TSDoc — units, ranges, edge-case values, computed-field formulas, originating endpoint.
- **Tier 2 — public hooks, discriminated unions, exported cross-module types**: interface summary; a "Variants:" list for unions; `@throws`/`@example` for hooks; per-field TSDoc on non-obvious fields.
- **Tier 3 — internal helpers**: one-line purpose; add `@example` ONLY for a gotcha (returns `undefined` first render, throws on empty, ordering requirement).

### Tier 1 boundary gotcha — wire type ≠ DB type

A DB `Date` is JSON-serialized to an ISO **string** by the time the browser reads it. Document this on every boundary field. Real boundary surfaces in this repo:

- Zod request schemas + `c.json(...)` responses in the route handlers (`src/server/routes/`).
- Client mirror types, e.g. the `AuthUser` interface (the JSON-serialized `users` row the browser sees).

Project ownership convention worth documenting on the type: order endpoints return **404 (never 403)** when an order is missing OR not owned by the caller, so a response never distinguishes "absent" from "forbidden."

```typescript
/**
 * A purchase as the browser sees it — the JSON-serialized `orders` row.
 * Returned by `GET /api/orders/:id`; 404 (never 403) when missing OR not owned.
 */
export interface OrderResponse {
	/** Charge amount in the smallest currency unit (cents for `usd`), not dollars */
	amount: number;
	/** Creation time as an ISO 8601 string — the DB `Date` serialized over JSON */
	createdAt: string;
	/** Lifecycle: `'pending'` until the Stripe webhook confirms, then `'paid'` */
	status: 'paid' | 'pending';
}
```

## Gotchas as load-bearing JSDoc

Non-obvious constraints (call ordering, side effects, env/SSR requirements) go in JSDoc on the function, not a buried inline comment. If a gotcha came from a past incident, say so briefly so the reader knows it's load-bearing, not paranoia.

```typescript
/**
 * **IMPORTANT:** must be called before first render. Called after hydration it
 * causes a flash of unstyled content — the theme context is absent during SSR.
 */
export function initializeTheme(theme: Theme): void { ... }
```

## File-level headers

Add a top-of-file comment (1-3 sentences) only when the file's role isn't obvious from its name (worker entry point, multi-subsystem wiring) or it embodies a non-trivial design decision worth flagging (e.g. why a module uses a manual ref pattern instead of `useState`).
</content>
