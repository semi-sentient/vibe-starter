import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAuth } from '@/auth/middleware';
import { db } from '@/db/client';
import { orders } from '@/db/schema';
import type { AppContext } from '@/server/app';

/**
 * Orders router, mounted at `/api/orders` (the app's `.basePath('/api')` + the
 * `/orders` mount). Every route is gated by `requireAuth` (the router-level
 * `.use` below), so `c.var.user` is always present.
 *
 * `orders` rows are user-owned, so every read here obeys THE OWNERSHIP RULE —
 * the single most important security invariant in the starter, guarded by the
 * access-control anchor test:
 *
 *   - Admins (`user.role === 'admin'`) pass `undefined` to `.where()` → NO
 *     filter → they see every row.
 *   - Everyone else is filtered to `eq(orders.userId, user.id)` → only their own.
 *
 * Do NOT collapse the admin branch into a single unconditional filter, and do NOT
 * "simplify" the ternary away — the `undefined`-for-admins shape IS the rule.
 *
 * `GET /:id` (and `/by-session/:id`) return **404** both when the order does not
 * exist AND when it exists but is not owned by a non-admin caller. They must
 * NEVER return 403 and NEVER leak existence — a 403 would tell an attacker the id
 * is real. P7 (Stripe) reuses this exact ownership shape for the order it writes
 * and for the `by-session` success-page lookup.
 *
 * Endpoints:
 *   - `GET /` — list the caller's orders (admins: all).
 *   - `GET /:id` — one order by id, owner-scoped, 404 guard.
 *   - `GET /by-session/:stripeCheckoutSessionId` — one order by Stripe Checkout
 *     session id, owner-scoped, 404 guard (the P7 success page reads this).
 */
const ordersRoutes = new Hono<AppContext>()
	.use('*', requireAuth())
	.get('/', async (c) => {
		const user = c.var.user;
		const rows = await db.query.orders.findMany({
			where: user.role === 'admin' ? undefined : eq(orders.userId, user.id),
		});
		return c.json({ orders: rows }, 200);
	})
	.get('/by-session/:stripeCheckoutSessionId', async (c) => {
		const user = c.var.user;
		const stripeCheckoutSessionId = c.req.param('stripeCheckoutSessionId');
		const order = await db.query.orders.findFirst({
			where:
				user.role === 'admin'
					? eq(orders.stripeCheckoutSessionId, stripeCheckoutSessionId)
					: and(
							eq(orders.stripeCheckoutSessionId, stripeCheckoutSessionId),
							eq(orders.userId, user.id)
						),
		});
		// 404 for both "no such session" and "not the caller's" — never leak.
		if (!order) return c.json({ error: 'Not found' }, 404);
		return c.json({ order }, 200);
	})
	.get('/:id', async (c) => {
		const user = c.var.user;
		const id = Number(c.req.param('id'));
		if (!Number.isInteger(id)) return c.json({ error: 'Not found' }, 404);

		const order = await db.query.orders.findFirst({
			where:
				user.role === 'admin'
					? eq(orders.id, id)
					: and(eq(orders.id, id), eq(orders.userId, user.id)),
		});
		// 404 for both "no such order" and "found but not owned by a non-admin".
		if (!order) return c.json({ error: 'Not found' }, 404);
		return c.json({ order }, 200);
	});

export { ordersRoutes };
