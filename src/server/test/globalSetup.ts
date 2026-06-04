/* eslint-disable import/order -- The `loadTestEnv()` call MUST run before any import
   that transitively pulls in `src/env.ts` (`@/db/migrate` -> `@/db/client` -> `@/env`).
   vitest.config.ts already loaded `.env.test` in this process, but globalSetup is an
   independent module graph, so we import the loader FIRST and call it before the db
   imports below are evaluated. `import/order` would group/reorder these imports and
   hoist the `@/db/*` ones above the call, breaking the env-loading sequence — so this
   block opts out of the rule. */
import { loadTestEnv } from './loadTestEnv';

loadTestEnv();

// These imports evaluate `src/env.ts`; safe now that `.env.test` is loaded above.
import { runMigrations } from '@/db/migrate';
import { Client } from 'pg';
/* eslint-enable import/order */

/**
 * Vitest global setup — runs ONCE in the main process before any test project.
 *
 * Ensures the dedicated test database (`vibe_starter_test`, per `.env.test`)
 * exists and is migrated to the current schema. The DEV database
 * (`vibe_starter`) is never referenced here.
 *
 * `CREATE DATABASE` cannot run inside a transaction or on a pooled connection,
 * so we use a one-off raw `pg.Client` connected to the `postgres` maintenance
 * database, then close it. Migrations then run via the PROGRAMMATIC migrator
 * (`runMigrations`), which targets the shared `db` pool — already bound to
 * `vibe_starter_test` because `.env.test` set `DATABASE_URL` before
 * `src/db/client.ts` was imported. We deliberately do NOT shell out to
 * `drizzle-kit migrate`: drizzle-kit auto-loads `.env` (the DEV db) and would
 * migrate the wrong database.
 */
export default async function setup(): Promise<void> {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('[test] DATABASE_URL is not set after loading .env.test.');
	}

	// Derive the maintenance DSN: same credentials/host/port, but the `postgres`
	// database (which always exists), so we can issue CREATE DATABASE. Using the
	// URL API keeps this robust to passwords, ports, and query params.
	const testDbUrl = new URL(databaseUrl);
	const testDbName = testDbUrl.pathname.replace(/^\//, '');
	if (!testDbName) {
		throw new Error(`[test] DATABASE_URL has no database name: ${databaseUrl}`);
	}

	const maintenanceUrl = new URL(databaseUrl);
	maintenanceUrl.pathname = '/postgres';

	const client = new Client({ connectionString: maintenanceUrl.toString() });
	await client.connect();
	try {
		const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
			testDbName,
		]);
		if (existing.rowCount === 0) {
			// Identifier can't be parameterized; testDbName comes from our own
			// committed `.env.test`, and we re-quote it defensively.
			await client.query(`CREATE DATABASE "${testDbName.replace(/"/g, '""')}"`);
		}
	} finally {
		await client.end();
	}

	// Migrate `vibe_starter_test` to the current schema (the shared `db` pool is
	// already bound to it). Idempotent: drizzle skips already-applied migrations.
	await runMigrations();
}
