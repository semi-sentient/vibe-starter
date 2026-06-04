import { Route, Routes } from 'react-router';
import { Layout } from '@/web/components/Layout';
import { Checkout } from '@/web/routes/Checkout';
import { CheckoutCancel } from '@/web/routes/CheckoutCancel';
import { CheckoutSuccess } from '@/web/routes/CheckoutSuccess';
import { Home } from '@/web/routes/Home';
import { Login } from '@/web/routes/Login';
import { Welcome } from '@/web/routes/Welcome';

/**
 * App router. Holds the `<Routes>` tree; the router provider and data/query
 * providers are mounted in `main.tsx`. New routes are added here.
 *
 * `/` is the public Welcome page; `/login` is the magic-link sign-in; `/app` is
 * the authed home a successful login redirects to. `/checkout` starts a Stripe
 * hosted-Checkout purchase, and Stripe redirects back to `/checkout/success`
 * (which polls for the webhook-confirmed `paid` status) or `/checkout/cancel`.
 *
 * The authed routes (`/app` and the `/checkout*` flow) render inside `Layout`,
 * the shared app shell that supplies the top nav (Home/Checkout links, the
 * signed-in user, and Sign out). The public `/` and `/login` stay outside it.
 */
export function App() {
	return (
		<Routes>
			<Route path="/" element={<Welcome />} />
			<Route
				path="/app"
				element={
					<Layout>
						<Home />
					</Layout>
				}
			/>
			<Route
				path="/checkout"
				element={
					<Layout>
						<Checkout />
					</Layout>
				}
			/>
			<Route
				path="/checkout/cancel"
				element={
					<Layout>
						<CheckoutCancel />
					</Layout>
				}
			/>
			<Route
				path="/checkout/success"
				element={
					<Layout>
						<CheckoutSuccess />
					</Layout>
				}
			/>
			<Route path="/login" element={<Login />} />
		</Routes>
	);
}
