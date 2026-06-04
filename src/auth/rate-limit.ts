import { getConnInfo } from '@hono/node-server/conninfo';
import { sql } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { db } from '@/db/client';
import { rateLimitCounters } from '@/db/schema';

/** Default window: 10 minutes, matching the magic-link code TTL. */
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/** A literal key, or a function deriving one from the request (e.g. ip + email). */
type KeySource = string | ((c: Context) => string | Promise<string>);

interface RateLimitOptions {
	/** The counter key (a string, or a per-request function). One row per key. */
	key: KeySource;
	/** Max requests allowed per window before a `429`. */
	limit: number;
	/** Window length in milliseconds (default: 10 minutes). */
	window?: number;
}

/**
 * Derives the client IP for rate-limit keys.
 *
 * Prefers the LEFT-MOST hop of `X-Forwarded-For` — in production the nginx
 * reverse proxy (P12) sets this header, and the left-most entry is the original
 * client (a TRUSTED-PROXY assumption: only deploy behind a proxy that overwrites,
 * not appends, attacker-supplied XFF). Falls back to the socket remote address in
 * dev (no proxy), and finally to the stable placeholder `'unknown'` when neither
 * is available (e.g. in-process tests via `app.request`, which carry no
 * connection info) so keying never throws.
 */
export function clientIp(c: Context): string {
	const forwarded = c.req.header('x-forwarded-for');
	if (forwarded) {
		const first = forwarded.split(',')[0]?.trim();
		if (first) return first;
	}
	try {
		const address = getConnInfo(c).remote.address;
		if (address) return address;
	} catch {
		// No Node connection info (e.g. in-process test requests) — fall through.
	}
	return 'unknown';
}

/**
 * Postgres-backed FIXED-WINDOW rate limiter, mountable on any route.
 *
 * For the resolved `key`, the counter row is updated atomically in one upsert:
 * when the current window has elapsed (`now - window_start >= window`) it RESETS
 * to `{ count: 1, windowStart: now }`, otherwise it INCREMENTS `count`. The
 * upsert returns the post-update count; if it EXCEEDS `limit` the request is
 * rejected with `429` (and `next()` is not called). One row per key; a GC worker
 * (P8) drops rows older than the longest window.
 *
 * Shipped on the auth endpoints (`/api/auth/request-code`, `/api/auth/verify`) at
 * 5 per 10 minutes keyed by `(ip, email)`. The same middleware is the canonical
 * defense for any other abusable endpoint — e.g. a public contact form keyed by
 * IP (the first-feature tutorial, P15).
 *
 * NOTE: the design docs call this "sliding window", but the `(count, windowStart)`
 * schema is physically fixed-window — that is what ships.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
	const windowMs = options.window ?? DEFAULT_WINDOW_MS;

	return async (c, next) => {
		const key = typeof options.key === 'string' ? options.key : await options.key(c);
		const now = new Date();
		const windowStartFloor = new Date(now.getTime() - windowMs);

		// Atomic fixed-window step: insert a fresh window, or — if the existing
		// window has elapsed — reset it, else increment. `excluded.window_start`
		// is this request's `now` (the value we tried to insert).
		const [row] = await db
			.insert(rateLimitCounters)
			.values({ count: 1, key, windowStart: now })
			.onConflictDoUpdate({
				set: {
					count: sql`case
						when ${rateLimitCounters.windowStart} <= ${windowStartFloor.toISOString()}
						then 1
						else ${rateLimitCounters.count} + 1
					end`,
					windowStart: sql`case
						when ${rateLimitCounters.windowStart} <= ${windowStartFloor.toISOString()}
						then excluded.window_start
						else ${rateLimitCounters.windowStart}
					end`,
				},
				target: rateLimitCounters.key,
			})
			.returning({ count: rateLimitCounters.count });

		if (row && row.count > options.limit) {
			return c.json({ error: 'Too many requests. Please try again later.' }, 429);
		}

		await next();
	};
}
