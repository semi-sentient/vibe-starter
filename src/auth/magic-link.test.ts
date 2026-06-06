import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInvite } from '@/auth/invites';
import { requestCode, verifyCode } from '@/auth/magic-link';
import { db } from '@/db/client';
import { authCodes, invites, sessions, users } from '@/db/schema';
import { env } from '@/env';
import { createUser } from '@/server/test/factories/users';

// `env.ADMIN_EMAILS` is a parsed-once array; snapshot and restore it so the
// admin-allowlist tests can mutate it in isolation without leaking across tests.
let adminEmailsBackup: string[];
beforeEach(() => {
	adminEmailsBackup = [...env.ADMIN_EMAILS];
});
afterEach(() => {
	env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length, ...adminEmailsBackup);
	vi.restoreAllMocks();
});

/**
 * Reads the active code straight from the DB so verify tests use the REAL issued
 * code (it is random, so it can't be hardcoded). Mirrors how the route-level
 * anchor test learns the code.
 */
async function issuedCodeFor(email: string): Promise<string> {
	const [row] = await db.select().from(authCodes).where(eq(authCodes.email, email));
	if (!row) throw new Error(`no auth_code row for ${email}`);
	return row.code;
}

describe('requestCode', () => {
	it('upserts a 6-digit code row keyed on the lowercased email', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await requestCode('Person@Example.COM');

		const rows = await db.select().from(authCodes);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.email).toBe('person@example.com');
		expect(rows[0]?.code).toMatch(/^\d{6}$/);
		expect(rows[0]?.attempts).toBe(0);
	});

	it('keeps exactly one active code per email, replacing the prior one', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await requestCode('person@example.com');
		const first = await db
			.select()
			.from(authCodes)
			.where(eq(authCodes.email, 'person@example.com'));
		// Simulate a used attempt on the first code, then re-request.
		await db
			.update(authCodes)
			.set({ attempts: 3 })
			.where(eq(authCodes.email, 'person@example.com'));
		await requestCode('person@example.com');

		const rows = await db.select().from(authCodes);
		expect(rows).toHaveLength(1);
		// The replacement resets attempts to 0 and (almost surely) rotates the code.
		expect(rows[0]?.attempts).toBe(0);
		expect(first[0]?.code).toBeDefined();
	});
});

describe('verifyCode', () => {
	beforeEach(() => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('auto-creates a user (role "user") and a session on the first valid code', async () => {
		await requestCode('newbie@example.com');
		const code = await issuedCodeFor('newbie@example.com');

		const result = await verifyCode('newbie@example.com', code);

		expect(result).not.toBeNull();
		const [user] = await db.select().from(users).where(eq(users.email, 'newbie@example.com'));
		expect(user?.role).toBe('user');
		// The returned sessionId points at a real, persisted session for that user.
		const [session] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.id, result?.sessionId ?? ''));
		expect(session?.userId).toBe(user?.id);
	});

	it('grants admin to an ADMIN_EMAILS address (case-insensitive)', async () => {
		env.ADMIN_EMAILS.push('boss@example.com');
		await requestCode('Boss@Example.com');
		const code = await issuedCodeFor('boss@example.com');

		await verifyCode('Boss@Example.com', code);

		const [user] = await db.select().from(users).where(eq(users.email, 'boss@example.com'));
		expect(user?.role).toBe('admin');
	});

	it('never demotes: an admin removed from the allowlist keeps admin on next login', async () => {
		// First login while allowlisted → admin.
		env.ADMIN_EMAILS.push('shifting@example.com');
		await requestCode('shifting@example.com');
		await verifyCode('shifting@example.com', await issuedCodeFor('shifting@example.com'));

		// Removed from the allowlist. Roles are durable + upgrade-only, so with no
		// signal on this login the stored `admin` is PRESERVED, not recomputed away.
		// (Revocation is an explicit, out-of-band action — not a login side effect.)
		env.ADMIN_EMAILS.splice(0, env.ADMIN_EMAILS.length);
		await requestCode('shifting@example.com');
		await verifyCode('shifting@example.com', await issuedCodeFor('shifting@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'shifting@example.com'));
		expect(user?.role).toBe('admin');
	});

	it('upgrades an existing user added to the allowlist (break-glass)', async () => {
		const existing = await createUser({ email: 'promote@example.com', role: 'user' });

		env.ADMIN_EMAILS.push('promote@example.com');
		await requestCode('promote@example.com');
		await verifyCode('promote@example.com', await issuedCodeFor('promote@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'promote@example.com'));
		expect(user?.id).toBe(existing.id); // same row, upgraded in place
		expect(user?.role).toBe('admin');
	});

	it('keeps an existing admin (invite already consumed, not allowlisted) admin on re-login', async () => {
		// Models the core bug: invited as admin (invite long since consumed), NOT in
		// ADMIN_EMAILS. A later login has no signal, so the durable admin must stick.
		await createUser({ email: 'invited-admin@example.com', role: 'admin' });

		await requestCode('invited-admin@example.com');
		await verifyCode('invited-admin@example.com', await issuedCodeFor('invited-admin@example.com'));

		const [user] = await db
			.select()
			.from(users)
			.where(eq(users.email, 'invited-admin@example.com'));
		expect(user?.role).toBe('admin');
	});

	it('upgrades an existing user when a pending invite is consumed', async () => {
		const inviter = await createUser({ email: 'inviter@example.com', role: 'admin' });
		const existing = await createUser({ email: 'returning@example.com', role: 'user' });
		await createInvite('returning@example.com', 'admin', inviter.id);

		await requestCode('returning@example.com');
		await verifyCode('returning@example.com', await issuedCodeFor('returning@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'returning@example.com'));
		expect(user?.id).toBe(existing.id);
		expect(user?.role).toBe('admin');
		// The invite is still one-shot — consumed by this login.
		const inviteRows = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'returning@example.com'));
		expect(inviteRows).toHaveLength(0);
	});

	it('grants the invited role on first login and consumes the invite', async () => {
		const inviter = await createUser({ email: 'inviter@example.com', role: 'admin' });
		await createInvite('invited@example.com', 'admin', inviter.id);

		await requestCode('invited@example.com');
		await verifyCode('invited@example.com', await issuedCodeFor('invited@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'invited@example.com'));
		expect(user?.role).toBe('admin');
		// The invite is one-shot — consumed by the login.
		const inviteRows = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'invited@example.com'));
		expect(inviteRows).toHaveLength(0);
	});

	it('ADMIN_EMAILS takes precedence over an invite (and the invite is left intact)', async () => {
		const inviter = await createUser({ email: 'inviter@example.com', role: 'admin' });
		// Invite says "user", but the allowlist says "admin" — the allowlist wins
		// and the invite is not consumed (the admin branch short-circuits).
		await createInvite('vip@example.com', 'user', inviter.id);
		env.ADMIN_EMAILS.push('vip@example.com');

		await requestCode('vip@example.com');
		await verifyCode('vip@example.com', await issuedCodeFor('vip@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'vip@example.com'));
		expect(user?.role).toBe('admin');
		const inviteRows = await db
			.select()
			.from(invites)
			.where(eq(invites.email, 'vip@example.com'));
		expect(inviteRows).toHaveLength(1);
	});

	it('falls back to "user" when there is no invite and the email is not allowlisted', async () => {
		await requestCode('plain@example.com');
		await verifyCode('plain@example.com', await issuedCodeFor('plain@example.com'));

		const [user] = await db.select().from(users).where(eq(users.email, 'plain@example.com'));
		expect(user?.role).toBe('user');
	});

	it('rejects a wrong code (returns null) and increments attempts', async () => {
		await requestCode('person@example.com');

		const result = await verifyCode('person@example.com', '000000-wrong');

		expect(result).toBeNull();
		const [row] = await db
			.select()
			.from(authCodes)
			.where(eq(authCodes.email, 'person@example.com'));
		expect(row?.attempts).toBe(1);
	});

	it('rejects an expired code and clears the row', async () => {
		await requestCode('person@example.com');
		const code = await issuedCodeFor('person@example.com');
		await db
			.update(authCodes)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(authCodes.email, 'person@example.com'));

		expect(await verifyCode('person@example.com', code)).toBeNull();
		const rows = await db
			.select()
			.from(authCodes)
			.where(eq(authCodes.email, 'person@example.com'));
		expect(rows).toHaveLength(0);
	});

	it('invalidates the code after 5 failed attempts (the correct code then fails)', async () => {
		await requestCode('person@example.com');
		const code = await issuedCodeFor('person@example.com');

		// Five wrong submissions exhaust the attempt budget and delete the row.
		for (let i = 0; i < 5; i += 1) {
			await verifyCode('person@example.com', 'bad-code');
		}

		// Even the correct code now fails — there is no active code anymore.
		expect(await verifyCode('person@example.com', code)).toBeNull();
	});
});
