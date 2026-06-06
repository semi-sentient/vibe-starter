import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db/client';
import { sessions } from '@/db/schema';

type Session = typeof sessions.$inferSelect;

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function freshExpiry(): Date {
	return new Date(Date.now() + SESSION_TTL_MS);
}

/**
 * Creates a new session for `userId` and returns the opaque session id (`sid`).
 *
 * The `sid` is 32 random bytes encoded as base64url — unguessable and used both
 * as the `sessions.id` primary key and as the value carried in the signed `sid`
 * cookie. The session expires 24h from now (sliding-refreshed on each read by
 * {@link getSession}).
 */
export async function createSession(userId: number): Promise<string> {
	const id = randomBytes(32).toString('base64url');
	await db.insert(sessions).values({ expiresAt: freshExpiry(), id, userId });
	return id;
}

/**
 * Loads the session for `sid`, applying a sliding refresh.
 *
 * Returns `null` when the session is unknown or already expired. On a hit, the
 * session's `expiresAt` is unconditionally pushed to now+24h (sliding window, so
 * active users stay signed in) and the refreshed row is returned. Expired rows
 * are left in place for the periodic GC worker (P8) to delete.
 */
export async function getSession(sid: string): Promise<Session | null> {
	const [refreshed] = await db
		.update(sessions)
		.set({ expiresAt: freshExpiry() })
		.where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
		.returning();
	return refreshed ?? null;
}

/** Deletes the session row for `sid` (logout). A no-op if it doesn't exist. */
export async function destroySession(sid: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sid));
}
