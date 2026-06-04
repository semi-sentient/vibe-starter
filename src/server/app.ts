import { csrf } from '@/auth/csrf';
import type { AuthUser } from '@/auth/types';
import { db } from '@/db/client';
import { authRoutes } from '@/server/routes/auth.routes';
import { invitesRoutes } from '@/server/routes/invites.routes';
import { ordersRoutes } from '@/server/routes/orders.routes';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

/**
 * Paths exempt from the CSRF Origin check. The Stripe webhook (P7,
 * `POST /api/stripe/webhook`) is server-to-server and authenticated by signature
 * — NOT a cookie-authenticated browser request — so it must bypass the check.
 * The path is listed here NOW (the route lands in P7) as the documented
 * exemption hook: P7 only needs to add the route, not touch this wiring.
 */
const CSRF_EXEMPT_PATHS = ['/api/stripe/webhook'];

/**
 * Hono context type, owned here in `app.ts`.
 *
 * P4 (auth) added `user`, set by the `requireAuth` middleware on protected
 * routes (`c.var.user`). Later phases widen it further — the logging phase (P8)
 * adds `logger`. Routes that don't run `requireAuth` simply never read `user`.
 */
type AppContext = { Variables: { user: AuthUser } };

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
const app = new Hono<AppContext>()
	.basePath('/api')
	// CSRF defense-in-depth: reject non-GET requests with a mismatched Origin.
	// Mounted FIRST so it guards every route below; the Stripe webhook (P7) is
	// exempted via CSRF_EXEMPT_PATHS. Rate limiting lives inside the auth router
	// (on request-code/verify), not here.
	.use('*', csrf({ exemptPaths: CSRF_EXEMPT_PATHS }))
	.get('/health', async (c) => {
		try {
			await db.execute(sql`select 1`);
			return c.json({ db: 'up', status: 'ok' }, 200);
		} catch {
			return c.json({ db: 'down', status: 'degraded' }, 503);
		}
	})
	// Magic-link auth, served under `/api/auth/*` (basePath + this mount).
	.route('/auth', authRoutes)
	// Admin-only out-of-band role grants, served under `/api/invites/*`.
	.route('/invites', invitesRoutes)
	// User-owned orders, served under `/api/orders/*` (owner-scoped reads).
	.route('/orders', ordersRoutes);

export { app };

/** Exported for the frontend Hono RPC client (`hc<AppType>`). */
export type AppType = typeof app;

/** The Hono context type (Variables incl. `user`), for middleware/route typing. */
export type { AppContext };
