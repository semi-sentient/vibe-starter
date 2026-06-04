import { db } from '@/db/client';
import { orders } from '@/db/schema';

type InsertOrder = typeof orders.$inferInsert;
type Order = typeof orders.$inferSelect;

// Monotonic counter so each `createOrder()` produces a UNIQUE
// `stripeCheckoutSessionId` (that column is UNIQUE). Only uniqueness matters
// here, not determinism — deterministic IDS come from `resetDb`'s RESTART
// IDENTITY, which is what the access-control anchor test asserts on.
let sequence = 0;

/**
 * Inserts one `orders` row and returns it.
 *
 * `userId` is required (it is a NOT NULL foreign key with no sensible default —
 * an order belongs to someone). Everything else is defaulted to the shipped demo
 * purchase so the common case is `await createOrder({ userId: user.id })`:
 *
 *   const order = await createOrder({ userId: user.id });
 *   const paid = await createOrder({ status: 'paid', userId: admin.id });
 *
 * Defaults match the demo Checkout line item: `description: 'Sample item'`,
 * `amount: 1000` (smallest currency unit), `currency: 'usd'`, `status: 'pending'`.
 * A unique `stripeCheckoutSessionId` (`cs_test_<n>`) is generated per call;
 * override it to pin a specific Stripe session id (e.g. the `by-session` lookup).
 * P7 extends this factory for the Stripe write path.
 *
 * Returns the full inserted row.
 */
export async function createOrder(
	overrides: Partial<InsertOrder> & Pick<InsertOrder, 'userId'>
): Promise<Order> {
	sequence += 1;
	const values: InsertOrder = {
		amount: 1000,
		currency: 'usd',
		description: 'Sample item',
		status: 'pending',
		stripeCheckoutSessionId: `cs_test_${sequence}`,
		...overrides,
	};

	const [row] = await db.insert(orders).values(values).returning();
	// `.returning()` on a single-row insert always yields exactly one row; the
	// throw is a type-narrowing guard that should never fire.
	if (!row) throw new Error('[test] createOrder: insert returned no row');
	return row;
}
