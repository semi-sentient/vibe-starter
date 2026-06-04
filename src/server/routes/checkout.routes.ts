import { Hono } from 'hono';
import { requireAuth } from '@/auth/middleware';
import { createCheckoutSession } from '@/payments/stripe';
import type { AppContext } from '@/server/app';

/**
 * Checkout router, mounted at `/api/checkout` (the app's `.basePath('/api')` +
 * the `/checkout` mount). Session-protected by `requireAuth`, so `c.var.user` is
 * always present.
 *
 *   - `POST /` — create a Stripe hosted Checkout Session for the signed-in user
 *     and return `{ url }`. `createCheckoutSession` persists a `pending`,
 *     user-owned `orders` row (keyed by the session id) BEFORE the URL comes back,
 *     so the success page can poll it and the webhook has a row to flip to `paid`.
 *
 * The shipped demo charges a single placeholder line item (`'Sample item'`,
 * $10.00). Replace it with whatever your project sells — pass a `lineItem` to
 * `createCheckoutSession` (or add a validated request body here).
 */
const checkoutRoutes = new Hono<AppContext>().post('/', requireAuth(), async (c) => {
	const url = await createCheckoutSession({ userId: c.var.user.id });
	return c.json({ url }, 200);
});

export { checkoutRoutes };
