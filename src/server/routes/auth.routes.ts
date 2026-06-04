import { readSessionCookie, clearSessionCookie, setSessionCookie } from '@/auth/cookie';
import { requestCode, verifyCode } from '@/auth/magic-link';
import { requireAuth } from '@/auth/middleware';
import { destroySession } from '@/auth/sessions';
import type { AppContext } from '@/server/app';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

const requestCodeSchema = z.object({ email: z.string().email() });
const verifySchema = z.object({ code: z.string(), email: z.string().email() });

/**
 * Magic-link auth router, mounted at `/api/auth` (the app's `.basePath('/api')`
 * + the `/auth` mount). Endpoints:
 *   - `POST /request-code` (open) — issue a code; always `200 { ok: true }`.
 *   - `POST /verify` — exchange a code for a session; sets the signed `sid`
 *     cookie and returns `{ user }`, or `401` for a bad/expired/over-attempt code.
 *   - `POST /logout` — destroy the session, clear the cookie; `204`.
 *   - `GET /me` (requireAuth) — return the current `{ user }`.
 *
 * Rate limiting (429) on the open endpoints arrives in P5.
 */
const authRoutes = new Hono<AppContext>()
	.post('/request-code', zValidator('json', requestCodeSchema), async (c) => {
		const { email } = c.req.valid('json');
		// Open by design: never reveal whether the email has an account.
		await requestCode(email);
		return c.json({ ok: true }, 200);
	})
	.post('/verify', zValidator('json', verifySchema), async (c) => {
		const { code, email } = c.req.valid('json');
		const result = await verifyCode(email, code);
		if (!result) {
			return c.json(
				{ error: 'That code is incorrect or has expired. Please try again.' },
				401
			);
		}

		await setSessionCookie(c, result.sessionId);
		const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
		return c.json({ user }, 200);
	})
	.post('/logout', async (c) => {
		const sid = await readSessionCookie(c);
		if (sid) await destroySession(sid);
		clearSessionCookie(c);
		return c.body(null, 204);
	})
	.get('/me', requireAuth(), (c) => c.json({ user: c.var.user }, 200));

export { authRoutes };
