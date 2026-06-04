import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { orders } from '@/db/schema';
import { stripe } from '@/payments/stripe';
import { createUser } from '@/server/test/factories/users';
import { createTestServer } from '@/server/test/helpers/createTestServer';
import { loginAs } from '@/server/test/helpers/loginAs';

// `stripe.checkout.sessions.create` is spied so NO network call is made — it
// returns a fake hosted-Checkout session. The route still runs the real
// `createCheckoutSession`, so the pending-order persistence is exercised for real.
afterEach(() => {
	vi.restoreAllMocks();
});

function stubStripeSession(session: { id: string; url: string }) {
	return vi
		.spyOn(stripe.checkout.sessions, 'create')
		.mockResolvedValue(session as Awaited<ReturnType<typeof stripe.checkout.sessions.create>>);
}

describe('POST /api/checkout', () => {
	it('returns 401 when unauthenticated', async () => {
		const create = stubStripeSession({
			id: 'cs_test_unauth',
			url: 'https://checkout.stripe.com/c/pay/cs_test_unauth',
		});

		const res = await createTestServer().request('/api/checkout', { method: 'POST' });

		expect(res.status).toBe(401);
		// The Stripe API must not be touched for an unauthenticated request.
		expect(create).not.toHaveBeenCalled();
	});

	it('creates a pending order and returns the Stripe Checkout url for a signed-in user', async () => {
		const user = await createUser({ email: 'me@example.com', role: 'user' });
		stubStripeSession({
			id: 'cs_test_checkout',
			url: 'https://checkout.stripe.com/c/pay/cs_test_checkout',
		});

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/checkout', { method: 'POST' });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			url: 'https://checkout.stripe.com/c/pay/cs_test_checkout',
		});

		const [order] = await db
			.select()
			.from(orders)
			.where(eq(orders.stripeCheckoutSessionId, 'cs_test_checkout'));
		expect(order).toMatchObject({
			amount: 1000,
			description: 'Sample item',
			status: 'pending',
			userId: user.id,
		});
	});
});
