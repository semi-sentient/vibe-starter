import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { csrf } from '@/auth/csrf';
import type { AuthUser } from '@/auth/types';
import { db } from '@/db/client';
import { env } from '@/env';
import { logger, loggerMiddleware } from '@/server/logger';
import { authRoutes } from '@/server/routes/auth.routes';
import { checkoutRoutes } from '@/server/routes/checkout.routes';
import { invitesRoutes } from '@/server/routes/invites.routes';
import { ordersRoutes } from '@/server/routes/orders.routes';
import { stripeRoutes } from '@/server/routes/stripe.routes';

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
 * routes (`c.var.user`). P8 (logging) added `logger`, a per-request child set by
 * `loggerMiddleware` (mounted first, so `c.var.logger` is always present).
 * Routes that don't run `requireAuth` simply never read `user`.
 */
type AppContext = { Variables: { logger: Logger; user: AuthUser } };

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
	// Structured request logging. Mounted FIRST (before CSRF, routers, and the
	// Stripe webhook) so every request — including ones that error — carries the
	// same per-request `requestId`. It logs method/path/status/duration ONLY and
	// NEVER reads the body, so the Stripe webhook stays the sole consumer of the
	// raw body its signature check depends on (see logger.ts + stripe.routes.ts).
	.use('*', loggerMiddleware)
	// CSRF defense-in-depth: reject non-GET requests with a mismatched Origin.
	// Guards every route below; the Stripe webhook (P7) is exempted via
	// CSRF_EXEMPT_PATHS. Rate limiting lives inside the auth router (on
	// request-code/verify), not here.
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
	// Session-protected Stripe Checkout creation, served at `/api/checkout`.
	.route('/checkout', checkoutRoutes)
	// Admin-only out-of-band role grants, served under `/api/invites/*`.
	.route('/invites', invitesRoutes)
	// User-owned orders, served under `/api/orders/*` (owner-scoped reads).
	.route('/orders', ordersRoutes)
	// Stripe webhook (payment source of truth), served at `/api/stripe/webhook`
	// — raw-body signature verified, CSRF-exempt (see CSRF_EXEMPT_PATHS). The
	// `/api/checkout` session-protected create route is mounted alongside it.
	.route('/stripe', stripeRoutes)
	// Centralized error handler. Any uncaught error from the routes/middleware
	// above lands here: it is logged on the request-scoped logger (so the line
	// carries the same `requestId`), then a `500` is returned. The body is generic
	// in production; outside production it echoes the message + stack to aid local
	// debugging (never in prod — that would leak internals).
	.onError((err, c) => {
		(c.get('logger') ?? logger).error({ err }, 'unhandled error');
		if (env.NODE_ENV === 'production') {
			return c.json({ error: 'Internal Server Error' }, 500);
		}
		return c.json({ error: err.message, stack: err.stack }, 500);
	});

export { app };

/** Exported for the frontend Hono RPC client (`hc<AppType>`). */
export type AppType = typeof app;

/** The Hono context type (Variables incl. `logger`, `user`), for middleware/route typing. */
export type { AppContext };
