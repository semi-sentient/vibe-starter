import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { orders } from '@/db/schema';
import { env } from '@/env';
import { createCheckoutSession, handleWebhookEvent, stripe } from '@/payments/stripe';
import { createOrder } from '@/server/test/factories/orders';
import { createUser } from '@/server/test/factories/users';

/**
 * Builds a raw body + a VALID `stripe-signature` header for a
 * `checkout.session.completed` event, using Stripe's REAL offline HMAC crypto
 * (`generateTestHeaderString`) keyed by the test webhook secret. No network.
 */
function signedCompletedEvent(opts: { paymentIntent?: string; sessionId: string }): {
	rawBody: string;
	signature: string;
} {
	const event = {
		data: {
			object: {
				id: opts.sessionId,
				object: 'checkout.session',
				payment_intent: opts.paymentIntent ?? null,
			},
		},
		id: `evt_${opts.sessionId}`,
		type: 'checkout.session.completed',
	};
	const rawBody = JSON.stringify(event);
	const signature = stripe.webhooks.generateTestHeaderString({
		payload: rawBody,
		secret: env.STRIPE_WEBHOOK_SECRET,
	});
	return { rawBody, signature };
}

// The Stripe SDK is NEVER hit over the network here: `stripe.checkout.sessions.create`
// is spied so it returns a fake session synchronously. (The webhook anchor test uses
// the REAL `stripe.webhooks` HMAC crypto — that is offline, so it is not mocked.)
afterEach(() => {
	vi.restoreAllMocks();
});

describe('createCheckoutSession', () => {
	it('persists a pending order keyed by the session id BEFORE returning the url', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		const create = vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({
			id: 'cs_test_created',
			url: 'https://checkout.stripe.com/c/pay/cs_test_created',
		} as Awaited<ReturnType<typeof stripe.checkout.sessions.create>>);

		const url = await createCheckoutSession({ userId: user.id });

		expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_created');
		expect(create).toHaveBeenCalledTimes(1);

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_created'));
		expect(order).toMatchObject({
			amount: 1000,
			currency: 'usd',
			description: 'Sample item',
			status: 'pending',
			stripeCheckoutSessionId: 'cs_test_created',
			userId: user.id,
		});
		expect(order?.paidAt).toBeNull();
		expect(order?.stripePaymentIntentId).toBeNull();
	});
});

describe('handleWebhookEvent', () => {
	it('marks the matching pending order paid and records the payment intent (valid signature)', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_hook', userId: user.id });

		const { rawBody, signature } = signedCompletedEvent({
			paymentIntent: 'pi_test_123',
			sessionId: 'cs_test_hook',
		});
		await handleWebhookEvent(rawBody, signature);

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_hook'));
		expect(order?.status).toBe('paid');
		expect(order?.stripePaymentIntentId).toBe('pi_test_123');
		expect(order?.paidAt).toBeInstanceOf(Date);
	});

	it('throws on an invalid signature and changes nothing', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_bad', userId: user.id });

		const { rawBody } = signedCompletedEvent({ sessionId: 'cs_test_bad' });

		await expect(handleWebhookEvent(rawBody, 't=1,v1=deadbeef')).rejects.toThrow();

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_bad'));
		expect(order?.status).toBe('pending');
		expect(order?.paidAt).toBeNull();
		expect(order?.stripePaymentIntentId).toBeNull();
	});

	it('is idempotent: redelivering the same event does not re-process a paid order', async () => {
		const user = await createUser({ email: 'buyer@example.com' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_redeliver', userId: user.id });

		const first = signedCompletedEvent({
			paymentIntent: 'pi_first',
			sessionId: 'cs_test_redeliver',
		});
		await handleWebhookEvent(first.rawBody, first.signature);

		const [afterFirst] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_redeliver'));
		expect(afterFirst?.status).toBe('paid');
		const paidAtFirst = afterFirst?.paidAt;

		// A redelivery with a DIFFERENT payment intent must be a no-op (the
		// `AND status='pending'` guard makes the second update match no rows).
		const second = signedCompletedEvent({
			paymentIntent: 'pi_second',
			sessionId: 'cs_test_redeliver',
		});
		await handleWebhookEvent(second.rawBody, second.signature);

		const [afterSecond] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_redeliver'));
		expect(afterSecond?.status).toBe('paid');
		expect(afterSecond?.stripePaymentIntentId).toBe('pi_first');
		expect(afterSecond?.paidAt).toEqual(paidAtFirst);
	});
});
