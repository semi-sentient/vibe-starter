import { db } from '@/db/client';
import { users } from '@/db/schema';

type InsertUser = typeof users.$inferInsert;
type User = typeof users.$inferSelect;

// Monotonic counter so `createUser()` with no email produces a unique address
// each call (the `email` column is UNIQUE). Only uniqueness matters here, not
// determinism — deterministic IDS come from `resetDb`'s RESTART IDENTITY, which
// is what access-control tests assert on.
let sequence = 0;

/**
 * Inserts one `users` row and returns it.
 *
 * Defaults are filled in for every required/typically-varied column, so the
 * common case is a bare `await createUser()`. Pass `overrides` to pin any field
 * — most often `email` and/or `role`.
 *
 *   const alice = await createUser({ email: 'alice@example.com' });
 *   const boss = await createUser({ role: 'admin' });
 *
 * Returns the full inserted row (`id`, `email`, `role`, `createdAt`).
 */
export async function createUser(overrides: Partial<InsertUser> = {}): Promise<User> {
	sequence += 1;
	const values: InsertUser = {
		email: `user${sequence}@example.com`,
		...overrides,
	};

	const [row] = await db.insert(users).values(values).returning();
	// `.returning()` on a single-row insert always yields exactly one row; the
	// throw is a type-narrowing guard that should never fire.
	if (!row) throw new Error('[test] createUser: insert returned no row');
	return row;
}

/**
 * Seeds the two canonical actors used across access-control tests: one `admin`
 * and one regular `user`. Returns them keyed by role for readable test setup:
 *
 *   const { admin, user } = await setupUsers();
 */
export async function setupUsers(): Promise<{ admin: User; user: User }> {
	const admin = await createUser({ email: 'admin@example.com', role: 'admin' });
	const user = await createUser({ email: 'user@example.com', role: 'user' });
	return { admin, user };
}
