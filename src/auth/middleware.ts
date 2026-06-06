import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { readSessionCookie } from '@/auth/cookie';
import { getSession } from '@/auth/sessions';
import type { AuthUser } from '@/auth/types';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import type { AppContext } from '@/server/app';

/**
 * Gates a route behind a valid session.
 *
 * Reads the signed `sid` cookie, loads (and sliding-refreshes) the session, then
 * loads its user and attaches it as `c.var.user`. Responds `401` when the cookie
 * is missing/tampered, the session is unknown/expired, or the user no longer
 * exists. Downstream handlers can rely on `c.var.user` being present.
 *
 * `requireRole(role)` (below) COMPOSES this — it runs `requireAuth` first, then
 * asserts the role — so this stays focused on authentication.
 */
export function requireAuth(): MiddlewareHandler<AppContext> {
	return async (c, next) => {
		const sid = await readSessionCookie(c);
		if (!sid) return c.json({ error: 'Unauthorized' }, 401);

		const session = await getSession(sid);
		if (!session) return c.json({ error: 'Unauthorized' }, 401);

		const [user] = await db.select().from(users).where(eq(users.id, session.userId));
		if (!user) return c.json({ error: 'Unauthorized' }, 401);

		c.set('user', user);
		await next();
	};
}

/**
 * Gates a route behind a specific role.
 *
 * COMPOSES {@link requireAuth}: it first runs the full authentication check
 * (`401` when there is no valid session), then asserts `c.var.user.role` equals
 * the required `role`, responding `403` when the authenticated user lacks it.
 * Downstream handlers can rely on both a present `c.var.user` AND its role.
 *
 * This is the second of the two access-control levers (the other is the
 * ownership rule applied inline in user-owned queries): mount it on admin-only
 * routes, e.g. `app.post('/api/invites', requireRole('admin'), …)`.
 */
export function requireRole(role: AuthUser['role']): MiddlewareHandler<AppContext> {
	const auth = requireAuth();
	return async (c, next) => {
		// Run authentication. `requireAuth` invokes our inner `next` only after it
		// resolved a user; otherwise it returns its own 401 Response, which we
		// propagate unchanged.
		let authed = false;
		const unauthorized = await auth(c, () => {
			authed = true;
			// `requireAuth`'s `next` is typed `() => Promise<void>`; set the flag
			// synchronously (before the check below) and hand back a resolved promise.
			return Promise.resolve();
		});
		if (!authed) return unauthorized; // the 401 from requireAuth.

		if (c.var.user.role !== role) return c.json({ error: 'Forbidden' }, 403);
		await next();
	};
}
