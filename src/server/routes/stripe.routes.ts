import { Hono } from 'hono';
import { handleWebhookEvent } from '@/payments/stripe';
import type { AppContext } from '@/server/app';

/**
 * Stripe webhook router, mounted at `/api/stripe` (the app's `.basePath('/api')`
 * + the `/stripe` mount). The single endpoint is the payment SOURCE OF TRUTH —
 * the only place order status is mutated. The Checkout redirect is a UX
 * convenience, never trusted (a user can close the tab, lose connectivity, or
 * tamper with the redirect).
 *
 *   - `POST /webhook` — verify the Stripe event signature against the RAW request
 *     body, then apply it (idempotently). `400` on a missing/invalid signature;
 *     otherwise `200 { received: true }`.
 *
 * Two non-negotiables, both handled here + in `handleWebhookEvent`:
 *   1. RAW body. The signature is an HMAC over the EXACT bytes Stripe sent, so the
 *      body is read with `c.req.text()` — never a parsed/re-serialized JSON body.
 *      There is NO global JSON body parser in `app.ts`, and this path is listed in
 *      `CSRF_EXEMPT_PATHS` (server-to-server, authenticated by signature not by
 *      cookie/Origin), so nothing upstream consumes or rejects the request.
 *      NOTE for P8: when `loggerMiddleware` is mounted FIRST, it MUST NOT read the
 *      body — this route must remain the first and only consumer of it.
 *   2. Idempotency. `handleWebhookEvent` keys its effect on the Checkout session id
 *      with a `status = 'pending'` guard, so Stripe's redelivery-on-timeout is a
 *      no-op.
 */
const stripeRoutes = new Hono<AppContext>().post('/webhook', async (c) => {
	const signature = c.req.header('stripe-signature');
	// Read the RAW body BEFORE anything else parses it — the signature is over
	// these exact bytes.
	const rawBody = await c.req.text();

	if (!signature) {
		return c.json({ error: 'Missing stripe-signature header' }, 400);
	}

	try {
		await handleWebhookEvent(rawBody, signature);
	} catch {
		// A bad signature (or malformed payload) — never trust it. The thrown
		// `StripeSignatureVerificationError` is swallowed to a flat 400; details are
		// not echoed back to the caller.
		return c.json({ error: 'Invalid signature' }, 400);
	}

	return c.json({ received: true }, 200);
});

export { stripeRoutes };
