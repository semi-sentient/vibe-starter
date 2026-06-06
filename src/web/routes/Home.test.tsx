import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '@/web/auth/AuthProvider';
import { Home } from '@/web/routes/Home';
import { server } from '@/web/test/msw-server';

function renderHome() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<MemoryRouter>
					<Home />
				</MemoryRouter>
			</AuthProvider>
		</QueryClientProvider>
	);
}

describe('<Home /> (authed home)', () => {
	it('greets the signed-in user and offers a Sign out action', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderHome();

		expect(await screen.findByText(/her@example.com/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
	});

	it('offers a primary call-to-action linking to checkout', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderHome();

		const cta = await screen.findByRole('link', { name: 'Buy a sample item' });
		expect(cta).toHaveAttribute('href', '/checkout');
	});
});
