import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * Truncates every application table in the test database, resetting identity
 * sequences so primary keys restart at 1 on each test.
 *
 * Registered as a `beforeEach` hook by `src/server/test/setup.ts`, so every
 * backend test starts from an empty, deterministic database. The deterministic
 * ids matter: a later access-control (IDOR) anchor test asserts on predictable
 * ids like `1` and `2`.
 *
 * Tables are discovered DYNAMICALLY from the `public` schema rather than
 * hardcoded, so new tables added in later phases (sessions, orders, invites, …)
 * are truncated automatically — this helper never needs editing again. Drizzle's
 * migration-bookkeeping table is excluded so the schema stays migrated across
 * tests (by default drizzle keeps it in a separate `drizzle` schema, but we also
 * exclude it by name defensively).
 *
 * A single `TRUNCATE a, b, c RESTART IDENTITY CASCADE` truncates all tables in
 * one statement, so foreign-key ordering is irrelevant.
 */
export async function resetDb(): Promise<void> {
	const rows = await db.execute<{ tablename: string }>(sql`
		SELECT tablename
		FROM pg_tables
		WHERE schemaname = 'public'
		  AND tablename <> '__drizzle_migrations'
	`);

	const tables = rows.rows.map((row) => row.tablename);
	if (tables.length === 0) return;

	// Quote each identifier and schema-qualify it. Names come from pg_tables (our
	// own schema), but we quote defensively all the same.
	const quoted = tables.map((name) => `public."${name.replace(/"/g, '""')}"`).join(', ');

	await db.execute(sql.raw(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`));
}
