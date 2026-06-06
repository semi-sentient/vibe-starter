---
name: auth
description: How to add protected routes and enforce access control in this starter. Use when adding a route that requires login or an admin, querying or mutating user-owned data (the ownership / IDOR rule), working with roles or invites, or wiring auth/CSRF/rate-limit middleware.
---

# Auth & Access Control

This starter ships a working magic-link auth flow with session-backed authorization. Use the scaffold; do not reinvent it. The two highest-stakes levers — and the bugs they prevent — are:

1. **`requireRole('admin')`** on admin-only routes (prevents a regular `user` reaching an admin route).
2. **The ownership rule** on every user-owned query (prevents IDOR — one customer reading or mutating another customer's row).

Both are guarded by the access-control anchor test (`src/server/__tests__/access-control.test.ts`). When you add a user-owned resource, copy the `orders` resource (`src/server/routes/orders.routes.ts`) and that anchor test as your templates.

## The role model

Two roles ship as a Postgres enum (`src/db/schema.ts`):

```ts
export const roleEnum = pgEnum('role', ['admin', 'user']);
```

- **`admin`** — can manage all users' data and reach admin-only routes.
- **`user`** — can only access their own rows. The default for self-signup.

Roles are **durable and upgrade-only**: the stored `users.role` is the source of truth, and a login can only ever *raise* it, never lower it. `admin` is reached via two upgrade signals — the **`ADMIN_EMAILS`** env allowlist (comma-separated, case-insensitive) and **invites** — and absence of any signal on a login preserves the stored role. Everyone else is a `user`. Open self-signup is the default — the app is never invite-only.

`ADMIN_EMAILS` is a **bootstrap + break-glass** mechanism, not the ongoing management surface: membership guarantees a login resolves to *at least* `admin` and never demotes. Set it once to mint the first admin, then invite the rest from inside the app. Removing an email does NOT revoke that user's `admin` (see below).

```bash
# .env — bootstrap/break-glass: these emails resolve to at least admin at login.
ADMIN_EMAILS=owner@example.com,ops@example.com
```

### Invites (grant a durable role out-of-band)

For granting an elevated role to an email that is NOT on the allowlist, an admin can create an invite (`POST /api/invites`, `requireRole('admin')`). The role is applied on that email's **next** login, when `verifyCode` consumes the one-shot invite. Because roles are durable, the grant **persists** — an invited admin stays admin on every subsequent login, with no need to also add them to `ADMIN_EMAILS`.

Login role resolution (`src/auth/magic-link.ts`) — durable + upgrade-only:

```ts
// The login SIGNAL: ADMIN_EMAILS wins (and short-circuits); otherwise a pending
// invite is CONSUMED (one-shot) and its role is the signal; else no signal.
async function resolveRoleSignal(email: string): Promise<Role | null> {
	if (env.ADMIN_EMAILS.includes(email)) return 'admin';
	const invite = await consumeInvite(email);
	return invite?.role ?? null;
}

// New user → the signal, else 'user'. Existing user → the higher-privilege of
// their stored role and the signal, so a login only ever UPGRADES; no signal
// preserves the stored role. A returning user is never silently demoted.
async function resolveLoginRole(email: string, existing: Role | null): Promise<Role> {
	const signal = await resolveRoleSignal(email);
	if (existing === null) return signal ?? 'user';
	return signal === null ? existing : higherRole(existing, signal);
}
```

**Revocation (lowering a role) is intentionally out of scope** here — it is an extension point. Add an explicit admin action that writes the lower role directly (e.g. a `requireRole('admin')`-gated "demote" endpoint); do NOT make it a login side effect, so the admin set can't churn silently as `ADMIN_EMAILS` is edited.

## Adding a protected route

`requireAuth()` gates a route behind a valid session and attaches `c.var.user`. `requireRole(role)` composes it — it runs `requireAuth` first (401 when there's no session), then asserts the role (403 when the user lacks it). Both live in `src/auth/middleware.ts`.

```ts
import { requireAuth, requireRole } from '@/auth/middleware';

const router = new Hono<AppContext>()
	// Logged-in-only: c.var.user is guaranteed present below.
	.get('/me', requireAuth(), (c) => c.json({ user: c.var.user }))
	// Admin-only: 401 if unauthenticated, 403 if a non-admin.
	.post('/invites', requireRole('admin'), zValidator('json', schema), async (c) => {
		// ...
	});
```

Mount the router in `src/server/app.ts` with `.route('/things', thingRoutes)`.

## THE OWNERSHIP RULE (most important — do not get this wrong)

Every table of user-owned rows has a `userId` foreign key. **Every query against it MUST filter by the current user unless the caller is an `admin`.** This is the single most likely high-severity bug in a vibe-coded app (IDOR). Copy these two shapes verbatim.

### Read

```ts
import { and, eq } from 'drizzle-orm';

// List — admins pass `undefined` (no filter → all rows); users see only theirs.
const rows = await db.query.orders.findMany({
	where: user.role === 'admin' ? undefined : eq(orders.userId, user.id),
});

// Single row by id — owner-scoped.
const order = await db.query.orders.findFirst({
	where:
		user.role === 'admin'
			? eq(orders.id, id)
			: and(eq(orders.id, id), eq(orders.userId, user.id)),
});
```

**`GET /:id` for a missing OR not-owned row returns `404` — never `403`, never the row.** A 403 would tell an attacker the id is real; a 404 leaks nothing:

```ts
if (!order) return c.json({ error: 'Not found' }, 404);
```

### Mutate

`UPDATE ... WHERE id = $1 AND (userId = $2 OR <caller is admin>)` — fold the admin bypass into the `WHERE` so a non-admin can only touch their own row:

```ts
const ownership = user.role === 'admin' ? undefined : eq(orders.userId, user.id);

const [updated] = await db
	.update(orders)
	.set({ status: 'paid' })
	.where(and(eq(orders.id, id), ownership)) // `and(x, undefined)` === just `x`
	.returning();

// No row updated → didn't exist OR wasn't the caller's. 404, never 403.
if (!updated) return c.json({ error: 'Not found' }, 404);
```

> **DO NOT collapse the admin branch.** Don't replace the ternary with a single unconditional `eq(orders.userId, user.id)` (admins would lose access) and don't drop the filter entirely (every user would see everyone's rows). The `undefined`-for-admins shape IS the rule. The anchor test fails if you break it.

## Supporting middleware (already wired — don't re-add globally)

- **CSRF** (`src/auth/csrf.ts`, mounted in `app.ts`): rejects a non-GET request whose `Origin` header is present and mismatched (`403`); a missing `Origin` is allowed (`SameSite=Lax` + the signed cookie are the primary defense). Routes that are not cookie-authenticated browser requests (e.g. the Stripe webhook) opt out via `CSRF_EXEMPT_PATHS` in `app.ts`.
- **Rate limiting** (`src/auth/rate-limit.ts`): `rateLimit({ key, limit, window })` — a Postgres-backed fixed window. Shipped on the auth endpoints (5 / 10 min per `(ip, email)`). Reuse it on any abusable endpoint — e.g. a public contact form keyed by `clientIp(c)`. `clientIp` reads the left-most `X-Forwarded-For` hop (nginx sets it in prod), falling back to the socket address, then `'unknown'`.

## Escape hatch: multi-tenancy

The starter is single-tenant (one business, many user accounts). **If you build a true multi-tenant SaaS** (one deployment, many isolated organizations):

- Add a `tenants` table and a `tenantId` FK to every tenant-owned table.
- Resolve the current `tenantId` from the session at request time (store it on the session / user, and read it in middleware onto `c.var`).
- Scope **every** query by `tenantId` — *in addition to*, not instead of, the ownership rule. A `withTenantScope(tenantId)` helper keeps it idiomatic:

  ```ts
  where: and(
  	eq(things.tenantId, c.var.tenantId),
  	user.role === 'admin' ? undefined : eq(things.userId, user.id),
  )
  ```

- The highest-severity bug then becomes cross-tenant leakage; grow the anchor test with a "tenant A cannot read tenant B's data" case.

Do not add this speculatively — it is a documented graduation path, like Redis for the data store.
