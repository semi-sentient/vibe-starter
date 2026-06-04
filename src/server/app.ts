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
 */
const app = new Hono<AppContext>().basePath('/api').get('/health', (c) => {
	return c.json({ status: 'ok' });
});

export { app };

/** Exported for the frontend Hono RPC client (`hc<AppType>`). */
export type AppType = typeof app;
