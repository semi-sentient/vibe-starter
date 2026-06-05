import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkout } from '@/web/routes/Checkout';
import { server } from '@/web/test/msw-server';

// The component redirects via `window.location.href = url`. We can't let happy-dom
// actually navigate, but we must keep the real `location` otherwise (its `origin`
// is what resolves the relative `/api/checkout` fetch URL — replacing `location`
// wholesale breaks the request). So wrap it in a Proxy that records `href` writes
// and delegates everything else to the real object.
const hrefSetter = vi.fn();

beforeEach(() => {
	hrefSetter.mockClear();
	const realLocation = window.location;
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: new Proxy(realLocation, {
			get: (target, prop) => Reflect.get(target, prop),
			set: (target, prop, value) => {
				if (prop === 'href') {
					hrefSetter(value);
					return true;
				}
				return Reflect.set(target, prop, value);
			},
		}),
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function renderCheckout() {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={['/checkout']}>
				<Checkout />
			</MemoryRouter>
		</QueryClientProvider>
	);
}

describe('<Checkout />', () => {
	it('renders the demo purchase with a Buy now action', () => {
		renderCheckout();

		expect(screen.getByText('Sample item')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Buy now' })).toBeInTheDocument();
	});

	it('redirects the browser to the Stripe Checkout url after clicking Buy', async () => {
		server.use(
			http.post('/api/checkout', () =>
				HttpResponse.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_buy' })
			)
		);
		const user = userEvent.setup();
		renderCheckout();

		await user.click(screen.getByRole('button', { name: 'Buy now' }));

		await waitFor(() => {
			expect(hrefSetter).toHaveBeenCalledWith(
				'https://checkout.stripe.com/c/pay/cs_test_buy'
			);
		});
	});

	it('shows an error and does not redirect when checkout creation fails', async () => {
		server.use(http.post('/api/checkout', () => new HttpResponse(null, { status: 401 })));
		const user = userEvent.setup();
		renderCheckout();

		await user.click(screen.getByRole('button', { name: 'Buy now' }));

		expect(
			await screen.findByText('Could not start checkout. Please try again.')
		).toBeInTheDocument();
		expect(hrefSetter).not.toHaveBeenCalled();
	});
});
