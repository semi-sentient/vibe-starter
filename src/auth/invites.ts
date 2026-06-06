import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { invites } from '@/db/schema';

type Invite = typeof invites.$inferSelect;
type Role = Invite['role'];

/**
 * Records a pending out-of-band role grant for `email`.
 *
 * The `admin` role is normally granted via the `ADMIN_EMAILS` allowlist; an
 * invite is the escape hatch for granting an elevated role to an email NOT on the
 * allowlist. `email` is the primary key (one pending invite per email), so this
 * UPSERTS — re-inviting the same email replaces the role and `createdBy`. The
 * email is lowercased to match how `verifyCode`/`consumeInvite` look it up.
 *
 * `createdBy` is the id of the admin issuing the invite (the `orders`-style
 * audit FK on the row); the `POST /api/invites` route passes `c.var.user.id`.
 *
 * NOTE: this only WRITES the invite. The role is applied on the invitee's next
 * successful login, when {@link verifyCode} calls {@link consumeInvite}.
 */
export async function createInvite(
	rawEmail: string,
	role: Role,
	createdBy: number
): Promise<Invite> {
	const email = rawEmail.toLowerCase();
	const [invite] = await db
		.insert(invites)
		.values({ createdBy, email, role })
		.onConflictDoUpdate({ set: { createdBy, role }, target: invites.email })
		.returning();
	if (!invite) throw new Error('[auth] invite upsert returned no row');
	return invite;
}

/**
 * Atomically reads and removes the pending invite for `email`.
 *
 * Returns the invite row (so the caller can read its `role`) or `null` when there
 * is no pending invite. Implemented as a single `DELETE ... RETURNING`, so an
 * invite is one-shot: it grants its role exactly once, on the login that consumes
 * it. {@link verifyCode} uses the returned `role` as the non-admin fallback.
 */
export async function consumeInvite(rawEmail: string): Promise<Invite | null> {
	const email = rawEmail.toLowerCase();
	const [invite] = await db.delete(invites).where(eq(invites.email, email)).returning();
	return invite ?? null;
}
