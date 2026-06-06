import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { db } from '@/db/client';
import { orders, users } from '@/db/schema';
import { env } from '@/env';

/**
 * The shipped demo line item. The starter wires ONE placeholder purchase so the
 * Checkout flow runs end-to-end out of the box; replace it with whatever your
 * project actually sells (or pass `lineItem` to {@link createCheckoutSession}).
 * `amount` is in the smallest currency unit (cents).
 */
const SAMPLE_LINE_ITEM: CheckoutLineItem = {
	amount: 1000,
	currency: 'usd',
	name: 'Sample item',
};

/**
 * The Stripe API version this code is written against. PINNED to the literal the
 * installed `stripe` major expects (its types only reflect this version), so an
 * SDK bump that changes the wire shape surfaces as a TYPE error here rather than a
 * silent runtime drift. Bump it deliberately alongside the dependency.
 */
const STRIPE_API_VERSION = '2026-05-27.dahlia';

/**
 * The single shared Stripe client, configured from the server-only secret key.
 *
 * Exported so tests can stub the network boundary precisely — checkout tests
 * `vi.spyOn(stripe.checkout.sessions, 'create')` so no HTTP call is made, while
 * the webhook tests use the REAL `stripe.webhooks` HMAC crypto (which is offline,
 * so it is never mocked). Do NOT construct a second client.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
	apiVersion: STRIPE_API_VERSION,
	typescript: true,
});

/** A caller-supplied line item to charge for. */
export interface CheckoutLineItem {
	/** Charge amount in the smallest currency unit (e.g. cents for `usd`), not a decimal. */
	amount: number;
	/** ISO 4217 currency code, lowercase (e.g. `'usd'`) — as Stripe expects it. */
	currency: string;
	/** Human-readable product name shown on the Stripe Checkout page. */
	name: string;
}

/** Arguments to {@link createCheckoutSession}. */
export interface CreateCheckoutSessionArgs {
	/** Optional line item to charge for; defaults to the demo `'Sample item'`. */
	lineItem?: CheckoutLineItem;
	/** The buyer (`users.id`) — the order is created owned by them. */
	userId: number;
}

/**
 * Creates a Stripe hosted Checkout Session for `userId` and returns its URL.
 *
 * A `pending`, user-owned `orders` row is persisted (keyed by the returned
 * `session.id`) BEFORE the URL is returned, so the success page can poll for it
 * and the webhook has a row to flip to `paid`. The redirect is never trusted for
 * payment status — the webhook is the source of truth (see {@link handleWebhookEvent}).
 */
export async function createCheckoutSession(args: CreateCheckoutSessionArgs): Promise<string> {
	const { lineItem = SAMPLE_LINE_ITEM, userId } = args;

	const [user] = await db.select().from(users).where(eq(users.id, userId));
	if (!user) throw new Error(`[payments] createCheckoutSession: no user with id ${userId}`);

	const session = await stripe.checkout.sessions.create({
		cancel_url: `${env.APP_ORIGIN}/checkout/cancel`,
		customer_email: user.email,
		line_items: [
			{
				price_data: {
					currency: lineItem.currency,
					product_data: { name: lineItem.name },
					unit_amount: lineItem.amount,
				},
				quantity: 1,
			},
		],
		metadata: { userId: String(userId) },
		mode: 'payment',
		success_url: `${env.APP_ORIGIN}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
	});

	// Persist the pending order BEFORE returning the URL: the success page polls
	// `by-session`, and the webhook flips this exact row to `paid`.
	await db.insert(orders).values({
		amount: lineItem.amount,
		currency: lineItem.currency,
		description: lineItem.name,
		status: 'pending',
		stripeCheckoutSessionId: session.id,
		userId,
	});

	if (!session.url) {
		throw new Error('[payments] createCheckoutSession: Stripe returned no Checkout URL');
	}
	return session.url;
}

/**
 * Verifies a Stripe webhook event against the RAW request body, then applies its
 * effect. The webhook is the SOURCE OF TRUTH for payment status — the Checkout
 * redirect is never trusted.
 *
 * `constructEvent` re-computes the HMAC over `rawBody` with the webhook secret, so
 * the EXACT bytes Stripe sent must be passed (never a re-serialized body). A bad
 * signature THROWS — the route maps that to `400`; a verified event resolves.
 *
 * On `checkout.session.completed` the matching `orders` row is flipped to `paid`
 * via an idempotent UPDATE guarded by `status = 'pending'`, so a redelivery (Stripe
 * retries on timeout/failure) matches no rows and is a no-op. `invoice.paid` is a
 * forward-compat branch for subscriptions (Stripe Billing) and is NOT exercised by
 * the one-time payment flow the starter ships.
 */
export async function handleWebhookEvent(rawBody: string, signature: string): Promise<void> {
	// Throws `Stripe.errors.StripeSignatureVerificationError` on a bad signature.
	const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);

	switch (event.type) {
		case 'checkout.session.completed': {
			const session = event.data.object;
			await markOrderPaid(session.id, paymentIntentId(session.payment_intent));
			break;
		}
		// Forward-compat for subscriptions (Stripe Billing). NOT reached by the
		// shipped one-time `mode: 'payment'` flow — it is the documented hook for a
		// project that adopts recurring billing: drive renewal/order state off
		// `event.data.object` (a `Stripe.Invoice`) here. Intentionally a no-op today.
		case 'invoice.paid':
			break;
		default:
			// Other event types are ignored — only the ones above mutate state.
			break;
	}
}

/**
 * Idempotently marks the order for `stripeCheckoutSessionId` as `paid`. The
 * `status = 'pending'` guard makes a redelivered event match no rows, so
 * re-processing is a harmless no-op (no double-charging downstream effects).
 */
async function markOrderPaid(
	stripeCheckoutSessionId: string,
	stripePaymentIntentId: string | null
): Promise<void> {
	await db
		.update(orders)
		.set({ paidAt: new Date(), status: 'paid', stripePaymentIntentId })
		.where(
			and(
				eq(orders.stripeCheckoutSessionId, stripeCheckoutSessionId),
				eq(orders.status, 'pending')
			)
		);
}

/** Normalizes Stripe's `string | { id } | null` payment-intent field to its id (or null). */
function paymentIntentId(
	paymentIntent: string | Stripe.PaymentIntent | null | undefined
): string | null {
	if (!paymentIntent) return null;
	return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
}
