import { Link } from 'react-router';
import { Button } from '@/web/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/web/components/ui/card';

/**
 * Checkout cancel page (`/checkout/cancel`). Stripe redirects here when the user
 * abandons the hosted Checkout page. No order is paid (the `pending` row simply
 * stays pending until cleaned up), so this is purely informational with a way
 * back to try again.
 */
export function CheckoutCancel() {
	return (
		<div className="mx-auto flex max-w-lg flex-col">
			<Card>
				<CardHeader>
					<CardTitle>Checkout cancelled</CardTitle>
					<CardDescription>
						No charge was made. You can try again whenever you’re ready.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild variant="outline">
						<Link to="/checkout">Back to checkout</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
