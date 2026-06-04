import { pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

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
