import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/client';

/**
 * The application tables the checked-in migrations are expected to produce on a
 * freshly-migrated database. The Vitest `globalSetup` creates and migrates
 * `vibe_starter_test` before this runs, so querying the live catalog here proves
 * the migration chain replays cleanly end-to-end (a broken or half-authored
 * migration would change this set or fail the global setup outright).
 *
 * EXTENSION POINT: every later phase that adds a table MUST add its name here.
 * P4 (auth) adds `auth_codes`, `sessions`; P5 adds `invites`,
 * `rate_limit_counters`, `orders`; etc. Keep this sorted.
 */
const EXPECTED_TABLES = [
	'auth_codes',
	'invites',
	'orders',
	'rate_limit_counters',
	'sessions',
	'users',
] as const;

describe('migration chain', () => {
	it('produces exactly the expected application tables on a migrated database', async () => {
		const result = await db.execute<{ tablename: string }>(sql`
			SELECT tablename
			FROM pg_tables
			WHERE schemaname = 'public'
			  AND tablename <> '__drizzle_migrations'
			ORDER BY tablename
		`);

		const actual = result.rows.map((row) => row.tablename);

		expect(actual).toEqual([...EXPECTED_TABLES]);
	});
});
