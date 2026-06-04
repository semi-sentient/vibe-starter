import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createInvite, consumeInvite } from '@/auth/invites';
import { db } from '@/db/client';
import { invites } from '@/db/schema';
import { createUser } from '@/server/test/factories/users';

describe('invites', () => {
	it('createInvite persists a pending invite keyed by email', async () => {
		const admin = await createUser({ email: 'admin@example.com', role: 'admin' });

		const invite = await createInvite('Invitee@Example.com', 'admin', admin.id);

		// Email is normalized to lowercase (it is the primary key).
		expect(invite.email).toBe('invitee@example.com');
		expect(invite.role).toBe('admin');
		expect(invite.createdBy).toBe(admin.id);

		const [row] = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'invitee@example.com'));
		expect(row?.role).toBe('admin');
	});

	it('consumeInvite returns the invite and deletes it (one-shot)', async () => {
		const admin = await createUser({ email: 'admin@example.com', role: 'admin' });
		await createInvite('invitee@example.com', 'admin', admin.id);

		const consumed = await consumeInvite('Invitee@Example.com');
		expect(consumed?.role).toBe('admin');

		// The row is gone — a second consume yields null.
		expect(await consumeInvite('invitee@example.com')).toBeNull();
		const rows = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'invitee@example.com'));
		expect(rows).toHaveLength(0);
	});

	it('consumeInvite returns null when no invite exists for the email', async () => {
		expect(await consumeInvite('nobody@example.com')).toBeNull();
	});

	it('createInvite upserts — a second invite for the same email replaces the role', async () => {
		const admin = await createUser({ email: 'admin@example.com', role: 'admin' });
		await createInvite('invitee@example.com', 'user', admin.id);
		const updated = await createInvite('invitee@example.com', 'admin', admin.id);

		expect(updated.role).toBe('admin');
		const rows = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'invitee@example.com'));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.role).toBe('admin');
	});
});
