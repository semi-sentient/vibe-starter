import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { createInvite } from '@/auth/invites';
import { requireRole } from '@/auth/middleware';
import type { AppContext } from '@/server/app';

/**
 * Out-of-band role grants. `email` is lowercased downstream by `createInvite`;
 * `role` is constrained to the two shipped roles (so `'superuser'` → 400).
 */
const createInviteSchema = z.object({
	email: z.string().email(),
	role: z.enum(['admin', 'user']),
});

/**
 * Invites router, mounted at `/api/invites`. The single endpoint is admin-only —
 * `requireRole('admin')` returns 401 when unauthenticated and 403 for a non-admin
 * — making it the canonical example of an admin-gated route (and the half of the
 * access-control anchor test that proves a `user` cannot reach an admin route).
 *
 *   - `POST /` — create an invite; `201 { invite }`. The created invite grants its
 *     role to the invited email on that email's NEXT successful login (consumed by
 *     `verifyCode`). `createdBy` is the acting admin (`c.var.user.id`).
 */
const invitesRoutes = new Hono<AppContext>().post(
	'/',
	requireRole('admin'),
	zValidator('json', createInviteSchema),
	async (c) => {
		const { email, role } = c.req.valid('json');
		const invite = await createInvite(email, role, c.var.user.id);
		return c.json({ invite }, 201);
	}
);

export { invitesRoutes };
