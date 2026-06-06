import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { client } from '@/web/api/client';
import { Button } from '@/web/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/web/components/ui/card';

/** How often to re-poll the order while it is still `pending` (ms). */
const POLL_INTERVAL_MS = 1500;

/** The order status the success page cares about; `null` means "no row yet" (treat as pending). */
type OrderStatus = 'paid' | 'pending' | 'refunded' | null;

/**
 * Checkout success page (`/checkout/success?session_id=...`).
 *
 * Stripe redirects here after a (likely) successful payment, but the REDIRECT IS
 * NEVER TRUSTED as proof of payment — the user could have tampered with it. The
 * page reads `session_id` from the query and POLLS the owner-scoped
 * `GET /api/orders/by-session/:sessionId` until the status the WEBHOOK records is
 * `paid`. Until then it shows a "confirming" state; a not-found row (a brief race)
 * is also treated as "still confirming", never as failure.
 */
export function CheckoutSuccess() {
	const [searchParams] = useSearchParams();
	const sessionId = searchParams.get('session_id');

	const order = useQuery<OrderStatus>({
		enabled: sessionId !== null,
		queryFn: async () => {
			const res = await client.api.orders['by-session'][':stripeCheckoutSessionId'].$get({
				param: { stripeCheckoutSessionId: sessionId ?? '' },
			});
			// A 404 means the webhook-confirmed row isn't visible yet (race); keep polling.
			if (res.status === 404) return null;
			if (!res.ok) throw new Error('Could not check payment status.');
			const body = (await res.json()) as {
				order: { status: 'paid' | 'pending' | 'refunded' };
			};
			return body.order.status;
		},
		// Stop polling once the webhook has marked the order paid.
		refetchInterval: (query) => (query.state.data === 'paid' ? false : POLL_INTERVAL_MS),
		queryKey: ['orders', 'by-session', sessionId],
	});

	if (sessionId === null) {
		return (
			<SuccessShell title="No checkout session">
				<CardDescription>We couldn’t find a checkout session to confirm.</CardDescription>
				<BackHome />
			</SuccessShell>
		);
	}

	const paid = order.data === 'paid';

	return (
		<SuccessShell title={paid ? 'Thank you!' : 'Almost there'}>
			<CardDescription aria-live="polite">
				{paid ? "Payment received — you're all set." : 'Confirming your payment…'}
			</CardDescription>
			{paid ? <BackHome /> : null}
		</SuccessShell>
	);
}

/** Shared card chrome for the success page states. */
function SuccessShell({ children, title }: { children: ReactNode; title: string }) {
	return (
		<div className="mx-auto flex max-w-lg flex-col">
			<Card>
				<CardHeader>
					<CardTitle>{title}</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">{children}</CardContent>
			</Card>
		</div>
	);
}

/** A link back to the authed home. */
function BackHome() {
	return (
		<Button asChild variant="outline">
			<Link to="/app">Back to app</Link>
		</Button>
	);
}
