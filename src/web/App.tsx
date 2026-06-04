import { Checkout } from '@/web/routes/Checkout';
import { CheckoutCancel } from '@/web/routes/CheckoutCancel';
import { CheckoutSuccess } from '@/web/routes/CheckoutSuccess';
import { Home } from '@/web/routes/Home';
import { Login } from '@/web/routes/Login';
import { Welcome } from '@/web/routes/Welcome';
import { Route, Routes } from 'react-router';

/**
 * App router. Holds the `<Routes>` tree; the router provider and data/query
 * providers are mounted in `main.tsx`. New routes are added here.
 *
 * `/` is the public Welcome page; `/login` is the magic-link sign-in; `/app` is
 * the authed home a successful login redirects to. `/checkout` starts a Stripe
 * hosted-Checkout purchase, and Stripe redirects back to `/checkout/success`
 * (which polls for the webhook-confirmed `paid` status) or `/checkout/cancel`.
 */
export function App() {
	return (
		<Routes>
			<Route path="/" element={<Welcome />} />
			<Route path="/app" element={<Home />} />
			<Route path="/checkout" element={<Checkout />} />
			<Route path="/checkout/cancel" element={<CheckoutCancel />} />
			<Route path="/checkout/success" element={<CheckoutSuccess />} />
			<Route path="/login" element={<Login />} />
		</Routes>
	);
}
