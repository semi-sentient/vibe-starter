import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CheckoutSuccess } from '@/web/routes/CheckoutSuccess';
import { server } from '@/web/test/msw-server';

// Mount the success page at a URL carrying `?session_id=...`, exactly as Stripe's
// `success_url` redirect would. A short `refetchInterval` keeps the test fast.
function renderSuccess(sessionId?: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const entry =
		sessionId === undefined ? '/checkout/success' : `/checkout/success?session_id=${sessionId}`;
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={[entry]}>
				<Routes>
					<Route path="/checkout/success" element={<CheckoutSuccess />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>
	);
}

describe('<CheckoutSuccess />', () => {
	it('shows the confirming state while the order is still pending', async () => {
		server.use(
			http.get('/api/orders/by-session/:sessionId', () =>
				HttpResponse.json({ order: { status: 'pending', stripeCheckoutSessionId: 'cs_x' } })
			)
		);
		renderSuccess('cs_x');

		expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
	});

	it('polls until the webhook marks the order paid, then shows the success message', async () => {
		// First poll: still pending (webhook not in yet). Subsequent polls: paid.
		let calls = 0;
		server.use(
			http.get('/api/orders/by-session/:sessionId', () => {
				calls += 1;
				const status = calls >= 2 ? 'paid' : 'pending';
				return HttpResponse.json({ order: { status, stripeCheckoutSessionId: 'cs_x' } });
			})
		);
		renderSuccess('cs_x');

		// Starts on the confirming state…
		expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
		// …then flips once a poll observes the webhook-confirmed `paid` status. The
		// timeout exceeds the (real-time) poll interval so the 2nd poll lands.
		expect(
			await screen.findByText("Payment received — you're all set.", undefined, {
				timeout: 4000,
			})
		).toBeInTheDocument();
		expect(calls).toBeGreaterThanOrEqual(2);
	});

	it('shows the confirming state when the order is not found yet (404)', async () => {
		// The pending order is created server-side before the redirect, but a 404 is
		// possible in a race; treat it as "still confirming", never as failure.
		server.use(
			http.get(
				'/api/orders/by-session/:sessionId',
				() => new HttpResponse(null, { status: 404 })
			)
		);
		renderSuccess('cs_x');

		expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
	});

	it('does not call the API when no session_id is present', async () => {
		// No handler registered — `onUnhandledRequest: 'error'` would fail the test if
		// a request went out, proving the page does not poll without a session id.
		renderSuccess(undefined);

		expect(
			await screen.findByText('We couldn’t find a checkout session to confirm.')
		).toBeInTheDocument();
	});
});
