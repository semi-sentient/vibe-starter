import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { consumeInvite } from '@/auth/invites';
import { createSession } from '@/auth/sessions';
import { db } from '@/db/client';
import { authCodes, users } from '@/db/schema';
import { env } from '@/env';
import { sendMagicCode } from '@/server/email/resend';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

type Role = (typeof users.$inferSelect)['role'];

/**
 * Resolves the role to assign at login.
 *
 * Precedence: the `ADMIN_EMAILS` allowlist wins (and short-circuits, so an
 * allowlisted email never touches a pending invite). Otherwise a pending invite
 * is CONSUMED — `consumeInvite` reads and deletes it in one shot — and its role
 * is used; with no invite the role falls back to `'user'`. So open self-signup is
 * unaffected (a fresh non-admin signup is a `'user'`), while an invite is the
 * out-of-band escape hatch for granting an elevated role to a non-allowlisted
 * email.
 *
 * Because the invite is consumed here and `verifyCode` re-asserts the role on
 * EVERY login, an invited-admin who is NOT in `ADMIN_EMAILS` is re-evaluated on
 * their next login with the invite already gone, and resolves back to `'user'`.
 * Durable admins belong in `ADMIN_EMAILS`; invites are a one-time grant.
 */
async function resolveRole(email: string): Promise<Role> {
	if (env.ADMIN_EMAILS.includes(email)) return 'admin';
	const invite = await consumeInvite(email);
	return invite?.role ?? 'user';
}

/** A uniformly-random 6-digit code, zero-padded (e.g. `004217`). */
function generateCode(): string {
	return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Issues a magic-link sign-in code for `email`.
 *
 * The email is lowercased, then a fresh 6-digit code (10-minute TTL) is upserted
 * into `auth_codes` keyed on the email — there is ONE active code per email, so a
 * new request replaces any prior code and resets the failed-attempt counter. The
 * code is then sent via {@link sendMagicCode} (or logged in dev). Open by design:
 * requesting a code never reveals whether the email has an account.
 */
export async function requestCode(rawEmail: string): Promise<void> {
	const email = rawEmail.toLowerCase();
	const code = generateCode();
	const expiresAt = new Date(Date.now() + CODE_TTL_MS);

	await db
		.insert(authCodes)
		.values({ attempts: 0, code, email, expiresAt })
		.onConflictDoUpdate({
			set: { attempts: 0, code, expiresAt },
			target: authCodes.email,
		});

	await sendMagicCode(email, code);
}

/**
 * Verifies a submitted `code` for `email` and, on success, logs the user in.
 *
 * Returns `{ sessionId }` on success, or `null` for any auth failure (no code
 * requested, wrong code, expired code, or too many attempts) — the route maps
 * `null` to a `401`. Failure modes:
 *   - no active code, or the code has expired → `null` (expired row is deleted).
 *   - wrong code → the row's `attempts` is incremented; once it reaches the max
 *     (5) the code is invalidated (row deleted) so it can't be brute-forced.
 *
 * On success the code row is consumed (deleted), the user is upserted (auto-
 * created on first login) with the role from {@link resolveRole} — re-asserted
 * every login — and a fresh session is created.
 */
export async function verifyCode(
	rawEmail: string,
	code: string
): Promise<{ sessionId: string } | null> {
	const email = rawEmail.toLowerCase();

	const [row] = await db.select().from(authCodes).where(eq(authCodes.email, email));
	if (!row) return null;

	// Expired or already over the attempt ceiling — invalidate and reject.
	if (row.expiresAt.getTime() <= Date.now() || row.attempts >= MAX_ATTEMPTS) {
		await db.delete(authCodes).where(eq(authCodes.email, email));
		return null;
	}

	if (row.code !== code) {
		const attempts = row.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			// Spent the last allowed attempt on a wrong code: invalidate the code.
			await db.delete(authCodes).where(eq(authCodes.email, email));
		} else {
			await db.update(authCodes).set({ attempts }).where(eq(authCodes.email, email));
		}
		return null;
	}

	// Correct code: consume it, then upsert the user and open a session.
	await db.delete(authCodes).where(eq(authCodes.email, email));

	const role = await resolveRole(email);
	const [user] = await db
		.insert(users)
		.values({ email, role })
		.onConflictDoUpdate({ set: { role }, target: users.email })
		.returning();
	if (!user) throw new Error('[auth] user upsert returned no row');

	const sessionId = await createSession(user.id);
	return { sessionId };
}
