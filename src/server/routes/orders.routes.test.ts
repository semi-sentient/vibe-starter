import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/env';
import { createOrder } from '@/server/test/factories/orders';
import { createUser } from '@/server/test/factories/users';
import { createTestServer } from '@/server/test/helpers/createTestServer';
import { loginAs } from '@/server/test/helpers/loginAs';

// Magic-link sending falls back to console in tests; silence it. The admin tests
// push onto the parsed-once `env.ADMIN_EMAILS` array, so snapshot/restore it.
let adminEmailsBackup: string[];
beforeEach(() => {
	adminEmailsBackup = [...env.ADMIN_EMAILS];
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length, ...adminEmailsBackup);
	vi.restoreAllMocks();
});

describe('GET /api/orders', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await createTestServer().request('/api/orders');
		expect(res.status).toBe(401);
	});

	it('returns only the caller’s own orders for a regular user', async () => {
		const me = await createUser({ email: 'me@example.com', role: 'user' });
		const other = await createUser({ email: 'other@example.com', role: 'user' });
		await createOrder({ userId: me.id });
		await createOrder({ userId: me.id });
		await createOrder({ userId: other.id });

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/orders');

		expect(res.status).toBe(200);
		const { orders } = (await res.json()) as { orders: { userId: number }[] };
		expect(orders).toHaveLength(2);
		expect(orders.every((o) => o.userId === me.id)).toBe(true);
	});

	it('returns ALL orders for an admin', async () => {
		const me = await createUser({ email: 'me@example.com', role: 'user' });
		const other = await createUser({ email: 'other@example.com', role: 'user' });
		await createOrder({ userId: me.id });
		await createOrder({ userId: other.id });

		env.ADMIN_EMAILS.push('boss@example.com');
		const server = createTestServer();
		await loginAs(server, 'boss@example.com');
		const res = await server.request('/api/orders');

		expect(res.status).toBe(200);
		const { orders } = (await res.json()) as { orders: unknown[] };
		expect(orders).toHaveLength(2);
	});
});

describe('GET /api/orders/:id (the 404 ownership guard)', () => {
	it('returns the caller’s own order', async () => {
		const me = await createUser({ email: 'me@example.com', role: 'user' });
		const order = await createOrder({ userId: me.id });

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request(`/api/orders/${order.id}`);

		expect(res.status).toBe(200);
		const { order: got } = (await res.json()) as { order: { id: number } };
		expect(got.id).toBe(order.id);
	});

	it('returns 404 (NOT 403) for another user’s order — never leaks existence', async () => {
		await createUser({ email: 'me@example.com', role: 'user' });
		const other = await createUser({ email: 'other@example.com', role: 'user' });
		const theirOrder = await createOrder({ userId: other.id });

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request(`/api/orders/${theirOrder.id}`);

		expect(res.status).toBe(404);
	});

	it('returns 404 for an order that does not exist', async () => {
		await createUser({ email: 'me@example.com', role: 'user' });
		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/orders/999999');
		expect(res.status).toBe(404);
	});

	it('lets an admin read any user’s order', async () => {
		const other = await createUser({ email: 'other@example.com', role: 'user' });
		const theirOrder = await createOrder({ userId: other.id });

		env.ADMIN_EMAILS.push('boss@example.com');
		const server = createTestServer();
		await loginAs(server, 'boss@example.com');
		const res = await server.request(`/api/orders/${theirOrder.id}`);

		expect(res.status).toBe(200);
		const { order } = (await res.json()) as { order: { id: number } };
		expect(order.id).toBe(theirOrder.id);
	});
});

describe('GET /api/orders/by-session/:stripeCheckoutSessionId', () => {
	it('returns the caller’s order for a Stripe session id', async () => {
		const me = await createUser({ email: 'me@example.com', role: 'user' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_mine', userId: me.id });

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/orders/by-session/cs_test_mine');

		expect(res.status).toBe(200);
		const { order } = (await res.json()) as {
			order: { stripeCheckoutSessionId: string };
		};
		expect(order.stripeCheckoutSessionId).toBe('cs_test_mine');
	});

	it('returns 404 for another user’s session id (owner-scoped)', async () => {
		const me = await createUser({ email: 'me@example.com', role: 'user' });
		const other = await createUser({ email: 'other@example.com', role: 'user' });
		await createOrder({ stripeCheckoutSessionId: 'cs_test_theirs', userId: other.id });
		await createOrder({ userId: me.id });

		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/orders/by-session/cs_test_theirs');

		expect(res.status).toBe(404);
	});

	it('returns 404 for an unknown session id', async () => {
		await createUser({ email: 'me@example.com', role: 'user' });
		const server = createTestServer();
		await loginAs(server, 'me@example.com');
		const res = await server.request('/api/orders/by-session/cs_test_nope');
		expect(res.status).toBe(404);
	});
});
