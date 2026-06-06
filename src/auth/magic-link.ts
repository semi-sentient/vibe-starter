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
 * Privilege rank per role — higher wins. Roles are durable and UPGRADE-ONLY at
 * login (see {@link resolveLoginRole}), so a login can only ever raise a role,
 * never lower it. Keyed off `roleEnum`'s members; extend this map in lockstep if
 * a new role is added.
 */
const ROLE_RANK: Record<Role, number> = { admin: 1, user: 0 };

/** The more-privileged of two roles. */
function higherRole(a: Role, b: Role): Role {
	return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * Computes the role SIGNAL this login asserts, or `null` for no signal.
 *
 * Precedence: the `ADMIN_EMAILS` allowlist wins (and short-circuits, so an
 * allowlisted email never touches a pending invite) → `'admin'`. Otherwise a
 * pending invite is CONSUMED — `consumeInvite` reads and deletes it in one shot,
 * so it can't be replayed — and its role is the signal. With neither, there is no
 * signal (`null`).
 *
 * The signal only ever RAISES a role (see {@link resolveLoginRole}); it never
 * carries `'user'` as a downgrade. `ADMIN_EMAILS` is therefore a bootstrap +
 * break-glass guarantee of "at least admin", not the ongoing management surface.
 */
async function resolveRoleSignal(email: string): Promise<Role | null> {
	if (env.ADMIN_EMAILS.includes(email)) return 'admin';
	const invite = await consumeInvite(email);
	return invite?.role ?? null;
}

/**
 * Resolves the role to persist on login, given the user's currently-stored role
 * (`existing`, or `null` for a brand-new user).
 *
 * Roles are durable and UPGRADE-ONLY:
 *   - brand-new user → the login signal if present, else `'user'`;
 *   - existing user → the higher-privilege of their stored role and the signal,
 *     so a login can raise the role (e.g. break-glass via `ADMIN_EMAILS`, or a
 *     pending invite) but NEVER demote it. Absence of a signal preserves the
 *     stored role.
 *
 * Revocation (lowering a role) is deliberately an explicit, out-of-band action,
 * not a side effect of who is/isn't in `ADMIN_EMAILS` at login time.
 */
async function resolveLoginRole(email: string, existing: Role | null): Promise<Role> {
	const signal = await resolveRoleSignal(email);
	if (existing === null) return signal ?? 'user';
	return signal === null ? existing : higherRole(existing, signal);
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
 * created on first login) with the role from {@link resolveLoginRole} — durable
 * and upgrade-only, so a login can raise the stored role but never demote it —
 * and a fresh session is created.
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

	// Roles are durable and upgrade-only, so resolve against the CURRENT stored
	// role (if any). Any pending invite is still consumed exactly once inside
	// `resolveLoginRole`, whether or not it changes the persisted role.
	const [existing] = await db
		.select({ role: users.role })
		.from(users)
		.where(eq(users.email, email));
	const role = await resolveLoginRole(email, existing?.role ?? null);
	const [user] = await db
		.insert(users)
		.values({ email, role })
		.onConflictDoUpdate({ set: { role }, target: users.email })
		.returning();
	if (!user) throw new Error('[auth] user upsert returned no row');

	const sessionId = await createSession(user.id);
	return { sessionId };
}
