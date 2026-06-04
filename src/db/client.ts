import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { env } from '@/env';
import { logger } from '@/server/logger';

/**
 * The single shared Postgres connection pool. Built from `env.DATABASE_URL`,
 * which is validated at boot (`src/env.ts`).
 *
 * Import `{ db }` everywhere a query is needed — NEVER construct a second `Pool`.
 * `node-postgres`'s default pool settings are fine at prototype scale; revisit
 * only if a project hits pool exhaustion.
 */
const pool = new Pool({ connectionString: env.DATABASE_URL });

// node-postgres emits 'error' on IDLE clients when the backend dies (e.g. Postgres
// restarts/redeploys). Without a listener, Node treats it as an unhandled 'error'
// event and crashes the whole process — so a transient DB blip would take the API
// down instead of degrading it. Swallow-and-log keeps the server alive; the pool
// transparently re-establishes connections on the next query.
pool.on('error', (err) => {
	logger.error({ err }, 'idle database client error');
});

/** Drizzle client bound to the shared pool. The full `schema` is passed so `db.query.*` relational queries work. */
export const db = drizzle(pool, { schema });
