import { integer, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the single source of truth for the database shape.
 *
 * `drizzle-kit generate` diffs this file against `src/db/migrations/` to author
 * new SQL migrations. Every timestamp column uses `withTimezone: true`
 * (`timestamptz`); naive `timestamp` columns are a classic foot-gun.
 *
 * Later phases extend this file — auth (P4) adds `sessions`/`auth_codes`,
 * payments + limits (P5) add `invites`/`rate_limit_counters`/`orders` — all
 * reusing `roleEnum`. They are intentionally NOT defined yet.
 */

/** The two roles the app ships with. `admin` is granted via the `ADMIN_EMAILS` allowlist (added in P4). */
export const roleEnum = pgEnum('role', ['admin', 'user']);

/**
 * User accounts. Rows are auto-created on first magic-link login (P4); `role`
 * defaults to `'user'` and is re-asserted to `'admin'` for allowlisted emails.
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
