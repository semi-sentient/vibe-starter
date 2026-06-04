import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createSession, destroySession, getSession } from '@/auth/sessions';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { createUser } from '@/server/test/factories/users';

describe('createSession', () => {
	it('inserts a session row for the user and returns its opaque id', async () => {
		const user = await createUser();

		const sessionId = await createSession(user.id);

		expect(typeof sessionId).toBe('string');
		const row = await db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
		expect(row?.userId).toBe(user.id);
	});
});

describe('getSession', () => {
	it('returns the session for a valid, unexpired id', async () => {
		const user = await createUser();
		const sessionId = await createSession(user.id);

		const session = await getSession(sessionId);

		expect(session).not.toBeNull();
		expect(session?.userId).toBe(user.id);
	});

	it('slides the expiry forward on each successful read', async () => {
		const user = await createUser();
		const sessionId = await createSession(user.id);
		// Backdate the expiry to a known near-now value so the refresh is observable.
		const stale = new Date(Date.now() + 60 * 1000);
		await db.update(sessions).set({ expiresAt: stale }).where(eq(sessions.id, sessionId));

		const session = await getSession(sessionId);

		// Refreshed to ~now+24h, well beyond the 1-minute stale value.
		expect(session?.expiresAt.getTime()).toBeGreaterThan(stale.getTime());
	});

	it('returns null for an expired session', async () => {
		const user = await createUser();
		const sessionId = await createSession(user.id);
		await db
			.update(sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(sessions.id, sessionId));

		expect(await getSession(sessionId)).toBeNull();
	});

	it('returns null for an unknown session id', async () => {
		expect(await getSession('does-not-exist')).toBeNull();
	});
});

describe('destroySession', () => {
	it('makes the session unretrievable', async () => {
		const user = await createUser();
		const sessionId = await createSession(user.id);

		await destroySession(sessionId);

		expect(await getSession(sessionId)).toBeNull();
	});
});
