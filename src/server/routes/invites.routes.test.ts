import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { invites } from '@/db/schema';
import { env } from '@/env';
import { createUser } from '@/server/test/factories/users';
import { createTestServer } from '@/server/test/helpers/createTestServer';
import { loginAs } from '@/server/test/helpers/loginAs';

const json = { 'content-type': 'application/json' };

let adminEmailsBackup: string[];
beforeEach(() => {
	adminEmailsBackup = [...env.ADMIN_EMAILS];
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length, ...adminEmailsBackup);
	vi.restoreAllMocks();
});

describe('POST /api/invites', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await createTestServer().request('/api/invites', {
			body: JSON.stringify({ email: 'x@example.com', role: 'admin' }),
			headers: json,
			method: 'POST',
		});
		expect(res.status).toBe(401);
	});

	it('returns 403 for a regular user', async () => {
		await createUser({ email: 'user@example.com', role: 'user' });
		const server = createTestServer();
		await loginAs(server, 'user@example.com');

		const res = await server.request('/api/invites', {
			body: JSON.stringify({ email: 'invitee@example.com', role: 'admin' }),
			headers: json,
			method: 'POST',
		});
		expect(res.status).toBe(403);
	});

	it('creates an invite (201) for an admin and persists it', async () => {
		env.ADMIN_EMAILS.push('boss@example.com');
		const server = createTestServer();
		await loginAs(server, 'boss@example.com');

		const res = await server.request('/api/invites', {
			body: JSON.stringify({ email: 'Invitee@Example.com', role: 'admin' }),
			headers: json,
			method: 'POST',
		});

		expect(res.status).toBe(201);
		const { invite } = (await res.json()) as { invite: { email: string; role: string } };
		expect(invite.email).toBe('invitee@example.com');
		expect(invite.role).toBe('admin');

		const [row] = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'invitee@example.com'));
		expect(row?.role).toBe('admin');
	});

	it('returns 400 for an invalid body (bad email / bad role)', async () => {
		env.ADMIN_EMAILS.push('boss@example.com');
		const server = createTestServer();
		await loginAs(server, 'boss@example.com');

		const badEmail = await server.request('/api/invites', {
			body: JSON.stringify({ email: 'not-an-email', role: 'admin' }),
			headers: json,
			method: 'POST',
		});
		expect(badEmail.status).toBe(400);

		const badRole = await server.request('/api/invites', {
			body: JSON.stringify({ email: 'invitee@example.com', role: 'superuser' }),
			headers: json,
			method: 'POST',
		});
		expect(badRole.status).toBe(400);
	});
});
