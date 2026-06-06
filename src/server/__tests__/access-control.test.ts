import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/env';
import { createOrder } from '@/server/test/factories/orders';
import { setupUsers } from '@/server/test/factories/users';
import { createTestServer } from '@/server/test/helpers/createTestServer';
import { loginAs } from '@/server/test/helpers/loginAs';

/**
 * ANCHOR TEST #2 — the ownership / access-control invariant.
 *
 * This is the highest-stakes contract the starter enforces: the bug a vibe coder
 * is most likely to ship is broken access control / IDOR (one customer reading or
 * mutating another's data, or a regular user reaching an admin route). It guards
 * three behaviors and doubles as the copyable template for testing a new
 * user-owned resource:
 *
 *   1. A `user` cannot read another `user`'s order — `GET /api/orders/:id` for
 *      someone else's order returns 404 (NOT 403, NOT the row) — the IDOR guard.
 *   2. A `user` calling an admin-only route (`POST /api/invites`) gets 403.
 *   3. An `admin` sees EVERY user's orders via `GET /api/orders`.
 *
 * Relies on `resetDb`'s `RESTART IDENTITY` for deterministic ids (admin = 1,
 * user = 2 from `setupUsers`), and logs the admin in by allowlisting its email.
 */

const json = { 'content-type': 'application/json' };

let adminEmailsBackup: string[];
beforeEach(() => {
	adminEmailsBackup = [...env.ADMIN_EMAILS];
	// Magic-link sending falls back to console in tests; silence it.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length, ...adminEmailsBackup);
	vi.restoreAllMocks();
});

describe('access control (anchor)', () => {
	it('a user cannot read another user’s order — returns 404, never the row', async () => {
		const { admin, user } = await setupUsers();
		// An order owned by the ADMIN (id 1); the regular USER (id 2) must not see it.
		const adminsOrder = await createOrder({ userId: admin.id });

		const server = createTestServer();
		await loginAs(server, user.email);
		const res = await server.request(`/api/orders/${adminsOrder.id}`);

		// 404, not 403 — the response must not even reveal that the id exists.
		expect(res.status).toBe(404);
	});

	it('a regular user is rejected (403) from the admin-only POST /api/invites', async () => {
		const { user } = await setupUsers();
		const server = createTestServer();
		await loginAs(server, user.email);

		const res = await server.request('/api/invites', {
			body: JSON.stringify({ email: 'newadmin@example.com', role: 'admin' }),
			headers: json,
			method: 'POST',
		});

		expect(res.status).toBe(403);
	});

	it('an admin sees ALL users’ orders via GET /api/orders', async () => {
		const { admin, user } = await setupUsers();
		await createOrder({ userId: admin.id });
		await createOrder({ userId: user.id });
		await createOrder({ userId: user.id });

		// Allowlist the admin email so the magic-link login resolves the admin role.
		env.ADMIN_EMAILS.push(admin.email);
		const server = createTestServer();
		await loginAs(server, admin.email);
		const res = await server.request('/api/orders');

		expect(res.status).toBe(200);
		const { orders } = (await res.json()) as { orders: unknown[] };
		// All three orders across both users — admins are not owner-scoped.
		expect(orders).toHaveLength(3);
	});
});
