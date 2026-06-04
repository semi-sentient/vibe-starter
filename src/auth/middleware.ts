import { readSessionCookie } from '@/auth/cookie';
import { getSession } from '@/auth/sessions';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import type { AppContext } from '@/server/app';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';

/**
 * Gates a route behind a valid session.
 *
 * Reads the signed `sid` cookie, loads (and sliding-refreshes) the session, then
 * loads its user and attaches it as `c.var.user`. Responds `401` when the cookie
 * is missing/tampered, the session is unknown/expired, or the user no longer
 * exists. Downstream handlers can rely on `c.var.user` being present.
 *
 * P5 EXTENSION POINT: `requireRole(role)` will COMPOSE this — run `requireAuth`
 * first, then assert `c.var.user.role`. Keep this focused on authentication.
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
