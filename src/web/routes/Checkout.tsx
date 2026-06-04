import { useMutation } from '@tanstack/react-query';
import { client } from '@/web/api/client';
import { Button } from '@/web/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/web/components/ui/card';

/**
 * Checkout page (`/checkout`, behind auth). The frontend's payment job is small:
 * ask the backend to create a Stripe hosted Checkout Session, then redirect the
 * browser to Stripe's hosted page (Stripe renders the card form — card data never
 * touches this app). After payment, Stripe redirects back to `/checkout/success`.
 *
 * The shipped demo buys a single placeholder item (`'Sample item'`, $10.00).
 * Payment status is NEVER inferred from this redirect — it is confirmed
 * server-side by the Stripe webhook and reflected on the success page.
 */
export function Checkout() {
	const checkout = useMutation({
		mutationFn: async () => {
			const res = await client.api.checkout.$post();
			if (!res.ok) {
				throw new Error('Could not start checkout. Please try again.');
			}
			const body = await res.json();
			return body.url;
		},
		onSuccess: (url) => {
			// Hand the browser off to Stripe's hosted Checkout page.
			window.location.href = url;
		},
	});

	return (
		<div className="mx-auto flex max-w-lg flex-col">
			<Card>
				<CardHeader>
					<CardTitle>Sample item</CardTitle>
					<CardDescription>
						A $10.00 demo purchase. Clicking Buy now sends you to Stripe’s secure
						checkout page.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<Button
						disabled={checkout.isPending}
						onClick={() => checkout.mutate()}
						type="button"
					>
						{checkout.isPending ? 'Redirecting…' : 'Buy now'}
					</Button>
					{checkout.isError ? (
						<p className="text-destructive text-sm" role="alert">
							{checkout.error.message}
						</p>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
