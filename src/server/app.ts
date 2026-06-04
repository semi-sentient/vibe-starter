import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

/**
 * Hono context type, owned here in `app.ts`.
 *
 * Phase 1 ships an empty `Variables` map. Later phases widen it — the auth phase
 * adds `user`, the logging phase adds `logger`. Do not pre-add those here.
 */
type AppContext = { Variables: Record<string, never> };

/**
 * The Hono app. Routes are mounted under `.basePath('/api')`, so the path
 * `/health` below is served at `/api/health`. Because `/api` lives in the typed
 * route tree, the RPC client (`hc<AppType>`) is pointed at the ORIGIN, not `/api`.
 *
 * `/health` doubles as a DB liveness probe: it runs `SELECT 1` through the shared
 * Drizzle client. DB up → `200 { status: 'ok', db: 'up' }`; DB unreachable →
 * `503 { status: 'degraded', db: 'down' }` (the query error is swallowed — a 503
 * is the signal). Because a 503 is still a server response, the frontend treats
 * "got a response" as API-up and keys the Database badge off the `db` field.
 */
const app = new Hono<AppContext>().basePath('/api').get('/health', async (c) => {
	try {
		await db.execute(sql`select 1`);
		return c.json({ db: 'up', status: 'ok' }, 200);
	} catch {
		return c.json({ db: 'down', status: 'degraded' }, 503);
	}
});

export { app };

/** Exported for the frontend Hono RPC client (`hc<AppType>`). */
export type AppType = typeof app;
