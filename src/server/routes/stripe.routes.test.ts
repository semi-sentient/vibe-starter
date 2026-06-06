import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { orders } from '@/db/schema';
import { env } from '@/env';
import { stripe } from '@/payments/stripe';
import { createOrder } from '@/server/test/factories/orders';
import { createUser } from '@/server/test/factories/users';
import { createTestServer } from '@/server/test/helpers/createTestServer';

/**
 * Anchor test #3 — the payment webhook, the riskiest integration in the starter.
 *
 * Fully OFFLINE: the signed `stripe-signature` header is built with Stripe's REAL
 * HMAC crypto (`generateTestHeaderString`) and verified by `constructEvent`, both
 * pure functions keyed by `env.STRIPE_WEBHOOK_SECRET` (`whsec_dummy` in `.env.test`).
 * No Stripe account, no network. The route reads the RAW body via `c.req.text()`
 * and is CSRF-exempt (`CSRF_EXEMPT_PATHS`), so a POST with no Origin reaches it.
 *
 * Asserts the three contracts that keep payment status honest:
 *   - a valid `checkout.session.completed` flips the matching order to `paid` and
 *     records the payment intent, returning 200 `{ received: true }`;
 *   - an invalid signature returns 400 and changes nothing (order stays `pending`);
 *   - a redelivered event is idempotent (no re-processing).
 */

const STRIPE_SIGNATURE = 'stripe-signature';

afterEach(() => {
	vi.restoreAllMocks();
});

/** A raw `checkout.session.completed` event body, exactly as it would arrive on the wire. */
function completedEventBody(opts: { paymentIntent?: string; sessionId: string }): string {
	return JSON.stringify({
		data: {
			object: {
				id: opts.sessionId,
				object: 'checkout.session',
				payment_intent: opts.paymentIntent ?? null,
			},
		},
		id: `evt_${opts.sessionId}`,
		type: 'checkout.session.completed',
	});
}

/** A VALID signature header for `rawBody`, computed with the test webhook secret (offline). */
function sign(rawBody: string): string {
	return stripe.webhooks.generateTestHeaderString({
		payload: rawBody,
		secret: env.STRIPE_WEBHOOK_SECRET,
	});
}

describe('POST /api/stripe/webhook', () => {
	it('marks the matching order paid on a valid checkout.session.completed event', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_anchor', userId: user.id });

		const rawBody = completedEventBody({
			paymentIntent: 'pi_anchor_1',
			sessionId: 'cs_test_anchor',
		});
		const res = await createTestServer().request('/api/stripe/webhook', {
			body: rawBody,
			headers: { 'content-type': 'application/json', [STRIPE_SIGNATURE]: sign(rawBody) },
			method: 'POST',
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: true });

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_anchor'));
		expect(order?.status).toBe('paid');
		expect(order?.stripePaymentIntentId).toBe('pi_anchor_1');
		expect(order?.paidAt).toBeInstanceOf(Date);
	});

	it('returns 400 and changes nothing for an invalid signature', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_badsig', userId: user.id });

		const rawBody = completedEventBody({ sessionId: 'cs_test_badsig' });
		const res = await createTestServer().request('/api/stripe/webhook', {
			// A syntactically plausible but wrong signature.
			body: rawBody,
			headers: { 'content-type': 'application/json', [STRIPE_SIGNATURE]: 't=1,v1=deadbeef' },
			method: 'POST',
		});

		expect(res.status).toBe(400);

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_badsig'));
		expect(order?.status).toBe('pending');
		expect(order?.paidAt).toBeNull();
		expect(order?.stripePaymentIntentId).toBeNull();
	});

	it('returns 400 when the stripe-signature header is missing', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_nosig', userId: user.id });

		const rawBody = completedEventBody({ sessionId: 'cs_test_nosig' });
		const res = await createTestServer().request('/api/stripe/webhook', {
			body: rawBody,
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});

		expect(res.status).toBe(400);

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_nosig'));
		expect(order?.status).toBe('pending');
	});

	it('is idempotent: a redelivered event does not re-process the order', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_dup', userId: user.id });

		const firstBody = completedEventBody({
			paymentIntent: 'pi_dup_1',
			sessionId: 'cs_test_dup',
		});
		const server = createTestServer();
		const first = await server.request('/api/stripe/webhook', {
			body: firstBody,
			headers: { 'content-type': 'application/json', [STRIPE_SIGNATURE]: sign(firstBody) },
			method: 'POST',
		});
		expect(first.status).toBe(200);

		const [afterFirst] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_dup'));
		const paidAtFirst = afterFirst?.paidAt;

		// Redeliver with a DIFFERENT payment intent: the second delivery must be a
		// no-op (the order is already `paid`), so 200 but nothing changes.
		const secondBody = completedEventBody({
			paymentIntent: 'pi_dup_2',
			sessionId: 'cs_test_dup',
		});
		const second = await server.request('/api/stripe/webhook', {
			body: secondBody,
			headers: { 'content-type': 'application/json', [STRIPE_SIGNATURE]: sign(secondBody) },
			method: 'POST',
		});
		expect(second.status).toBe(200);

		const [afterSecond] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_dup'));
		expect(afterSecond?.status).toBe('paid');
		expect(afterSecond?.stripePaymentIntentId).toBe('pi_dup_1');
		expect(afterSecond?.paidAt).toEqual(paidAtFirst);
	});
});
