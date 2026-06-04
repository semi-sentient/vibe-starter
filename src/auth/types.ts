import type { users } from '@/db/schema';

/**
 * The authenticated user attached to the request context by `requireAuth`
 * (`c.var.user`). It is exactly the inferred `users` row — `{ id, email, role,
 * createdAt }` — so handlers read the same shape the DB returns.
 *
 * Defined in its own module to avoid an import cycle: `app.ts` references this
 * type in `AppContext`, while the `requireAuth` middleware imports `AppContext`
 * from `app.ts`.
 */
export type AuthUser = typeof users.$inferSelect;
