import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import pino, { type Logger } from 'pino';
import { env } from '@/env';

/**
 * The root application logger (pino). Structured JSON to stdout — the format
 * Railway (and most log aggregators) ingest natively, so there is no pretty-print
 * transport in the shipped build (add `pino-pretty` locally if you want one).
 *
 * The level is `info` by default; under `NODE_ENV=test` it is forced to `silent`
 * so the test runner's output stays clean. Tests that need to assert on logging
 * spy on {@link logger}'s methods (e.g. `logger.child`) rather than scraping
 * stdout.
 */
export const logger: Logger = pino({
	level: env.NODE_ENV === 'test' ? 'silent' : 'info',
});

/**
 * Hono middleware that attaches a per-request child logger to the context and
 * emits one structured `request` log line on completion.
 *
 * Mounted FIRST in `app.ts` (before CSRF, routers, and the Stripe webhook) so
 * every request — including errors surfaced by `app.onError` — carries the same
 * `requestId`. The child binds `{ path, requestId }`; on completion it logs
 * `{ durationMs, status }`.
 *
 * CRITICAL: this middleware MUST NOT read or consume the request body. The Stripe
 * webhook (`POST /api/stripe/webhook`) verifies its HMAC signature against the
 * EXACT raw bytes via `c.req.text()` and must be the sole body consumer; reading
 * the body here (even to log it) would break signature verification. Only
 * connection-level metadata (method, path, status, duration) is logged.
 */
export const loggerMiddleware: MiddlewareHandler<{ Variables: { logger: Logger } }> = async (
	c,
	next
) => {
	const requestId = randomUUID();
	const child = logger.child({ path: c.req.path, requestId });
	c.set('logger', child);

	const start = performance.now();
	try {
		await next();
	} finally {
		const durationMs = Math.round(performance.now() - start);
		child.info({ durationMs, status: c.res.status }, 'request');
	}
};
