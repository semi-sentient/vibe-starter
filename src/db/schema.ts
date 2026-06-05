import { integer, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the single source of truth for the database shape.
 *
 * `drizzle-kit generate` diffs this file against `src/db/migrations/` to author
 * new SQL migrations. Every timestamp column uses `withTimezone: true`
 * (`timestamptz`); naive `timestamp` columns are a classic foot-gun.
 *
 * Auth (P4) added `sessions`/`auth_codes`; access control + payments (P5) add
 * `invites`/`rate_limit_counters`/`orders`, all reusing `roleEnum`.
 */

/**
 * The two roles the app ships with. Roles are durable + upgrade-only: a login
 * can raise the stored role (via the `ADMIN_EMAILS` allowlist or an invite) but
 * never lowers it. `admin` is the elevated role; `user` the default (added in P4).
 */
export const roleEnum = pgEnum('role', ['admin', 'user']);

/**
 * Order lifecycle (P5). `pending` on creation; flipped to `paid` (idempotently)
 * by the Stripe webhook (P7); `refunded` is reserved for the refund workflow a
 * project adds when it needs one (`charge.refunded`).
 */
export const orderStatusEnum = pgEnum('order_status', ['pending', 'paid', 'refunded']);

/**
 * User accounts. Rows are auto-created on first magic-link login (P4); `role`
 * defaults to `'user'`. It is durable + upgrade-only — a login can raise it to
 * `'admin'` (allowlisted email or a consumed invite) but never demotes it.
 */
export const users = pgTable('users', {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	email: text('email').notNull().unique(),
	id: serial('id').primaryKey(),
	role: roleEnum('role').notNull().default('user'),
});

/**
 * Pending magic-link codes (P4). ONE active code per email — `requestCode`
 * upserts on the `email` primary key, so a fresh request replaces any prior code.
 * Codes are 6 digits, expire after 10 minutes, and track failed `attempts`
 * (5 max before the row is invalidated). A periodic worker (P8) GCs expired rows;
 * `verifyCode` also deletes the row on success.
 */
export const authCodes = pgTable('auth_codes', {
	attempts: integer('attempts').notNull().default(0),
	code: text('code').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	email: text('email').primaryKey(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * Server-side sessions (P4). The `id` is the opaque `sid` (32 random bytes,
 * base64url) carried in the signed `sid` cookie. TTL is 24h with sliding refresh:
 * `getSession` pushes `expiresAt` to now+24h on every successful read. Rows are
 * deleted on logout and GC'd when expired (P8 worker).
 */
export const sessions = pgTable('sessions', {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
});

/**
 * Out-of-band role grants (P5). The `admin` role is reached via the
 * `ADMIN_EMAILS` allowlist or an invite — the escape hatch for granting an
 * elevated role to an email that is NOT on the allowlist. `email` is the primary
 * key (one pending invite per email), so `createInvite` upserts on it. On the
 * next successful login `verifyCode` calls `consumeInvite(email)` — the row is
 * read and deleted (one-shot) and its `role` becomes the login's upgrade signal,
 * granting a DURABLE role that persists on later logins. Open signup is
 * unaffected: an email with no invite (and not allowlisted) resolves to `'user'`.
 */
export const invites = pgTable('invites', {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	email: text('email').primaryKey(),
	role: roleEnum('role').notNull(),
});

/**
 * Fixed-window rate-limit counters (P5). One row per limiter `key` (e.g.
 * `auth:request-code:<ip>:<email>`). The `rateLimit` middleware resets the row to
 * `{ count: 1, windowStart: now }` once `now - windowStart >= window`, otherwise
 * increments `count`; a request that pushes `count` past the limit is rejected
 * with `429`. The highest-volume of the housekeeping tables — a GC worker (P8)
 * drops rows older than the longest configured window.
 */
export const rateLimitCounters = pgTable('rate_limit_counters', {
	count: integer('count').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	key: text('key').primaryKey(),
	windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
});

/**
 * Payment facts (P5), intentionally DOMAIN-AGNOSTIC: who paid, how much, the
 * Stripe identifiers, and the status — with no foreign key to whatever the
 * project sells (link that however suits you: a nullable FK column, or the
 * `description`/Stripe `metadata`). Rows are user-owned, so every query obeys the
 * ownership rule (a customer sees only their own orders unless the caller is
 * `admin`). Created `pending` before the Checkout redirect (P7); the webhook
 * flips the matching row to `paid`. `description` is NOT NULL with no DB default —
 * every insert supplies it (the demo uses `'Sample item'`). `amount` is in the
 * smallest currency unit (e.g. cents).
 */
export const orders = pgTable('orders', {
	amount: integer('amount').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	currency: text('currency').notNull().default('usd'),
	description: text('description').notNull(),
	id: serial('id').primaryKey(),
	paidAt: timestamp('paid_at', { withTimezone: true }),
	status: orderStatusEnum('status').notNull().default('pending'),
	stripeCheckoutSessionId: text('stripe_checkout_session_id').notNull().unique(),
	stripePaymentIntentId: text('stripe_payment_intent_id'),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
});
