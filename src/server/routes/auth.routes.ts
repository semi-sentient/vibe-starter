import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { readSessionCookie, clearSessionCookie, setSessionCookie } from '@/auth/cookie';
import { requestCode, verifyCode } from '@/auth/magic-link';
import { requireAuth } from '@/auth/middleware';
import { clientIp, rateLimit } from '@/auth/rate-limit';
import { destroySession } from '@/auth/sessions';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import type { AppContext } from '@/server/app';

/** Rate-limit defaults for the open auth endpoints: 5 attempts per 10 minutes. */
const AUTH_RATE_LIMIT = 5;
const AUTH_RATE_WINDOW_MS = 10 * 60 * 1000;

const requestCodeSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ code: z.string(), email: z.string().email() });

/**
 * Builds a rate-limit key for an auth endpoint, keyed by `(ip, email)` so a flood
 * is scoped to one attacker hammering one address (the design's chosen key). The
 * email is read from the JSON body — Hono caches the parsed body, so the
 * downstream `zValidator('json')` re-reads it for free. A malformed/empty body
 * falls back to an email-less key (still IP-limited) rather than throwing.
 */
function authRateLimitKey(scope: string) {
	return async (c: Context): Promise<string> => {
		let email = '';
		try {
			const body: unknown = await c.req.json();
			if (body && typeof body === 'object' && 'email' in body) {
				const value = body.email;
				if (typeof value === 'string') email = value.toLowerCase();
			}
		} catch {
			// Non-JSON / empty body — key on IP alone.
		}
		return `auth:${scope}:${clientIp(c)}:${email}`;
	};
}

/**
 * Magic-link auth router, mounted at `/api/auth` (the app's `.basePath('/api')`
 * + the `/auth` mount). Endpoints:
 *   - `POST /request-code` (open) — issue a code; always `200 { ok: true }`.
 *   - `POST /verify` — exchange a code for a session; sets the signed `sid`
 *     cookie and returns `{ user }`, or `401` for a bad/expired/over-attempt code.
 *   - `POST /logout` — destroy the session, clear the cookie; `204`.
 *   - `GET /me` (requireAuth) — return the current `{ user }`.
 *
 * The open endpoints (`request-code`, `verify`) are rate-limited to 5 requests
 * per 10 minutes per `(ip, email)` — `request-code` is otherwise an email-bomb
 * vector and `verify` a brute-force vector. The limiter runs BEFORE validation so
 * a flood is throttled even when the body is junk. `resetDb` clears the counter
 * table between tests, so the happy-path/edge tests (one or two hits) stay green.
 */
const authRoutes = new Hono<AppContext>()
	.post(
		'/request-code',
		rateLimit({
			key: authRateLimitKey('request-code'),
			limit: AUTH_RATE_LIMIT,
			window: AUTH_RATE_WINDOW_MS,
		}),
		zValidator('json', requestCodeSchema),
		async (c) => {
			const { email } = c.req.valid('json');
			// Open by design: never reveal whether the email has an account.
			await requestCode(email);
			return c.json({ ok: true }, 200);
		}
	)
	.post(
		'/verify',
		rateLimit({
			key: authRateLimitKey('verify'),
			limit: AUTH_RATE_LIMIT,
			window: AUTH_RATE_WINDOW_MS,
		}),
		zValidator('json', verifySchema),
		async (c) => {
			const { code, email } = c.req.valid('json');
			const result = await verifyCode(email, code);
			if (!result) {
				return c.json(
					{ error: 'That code is incorrect or has expired. Please try again.' },
					401
				);
			}

			await setSessionCookie(c, result.sessionId);
			const [user] = await db
				.select()
				.from(users)
				.where(eq(users.email, email.toLowerCase()));
			return c.json({ user }, 200);
		}
	)
	.post('/logout', async (c) => {
		const sid = await readSessionCookie(c);
		if (sid) await destroySession(sid);
		clearSessionCookie(c);
		return c.body(null, 204);
	})
	.get('/me', requireAuth(), (c) => c.json({ user: c.var.user }, 200));

export { authRoutes };
