import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '@/web/auth/AuthProvider';
import { Layout } from '@/web/components/Layout';
import { server } from '@/web/test/msw-server';

function renderLayout(children?: ReactNode) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<MemoryRouter>
					<Layout>{children}</Layout>
				</MemoryRouter>
			</AuthProvider>
		</QueryClientProvider>
	);
}

describe('<Layout />', () => {
	it('shows the signed-in user and a Sign out action in the nav', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderLayout();

		expect(await screen.findByText(/her@example.com/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
	});

	it('exposes Home and Checkout navigation links', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderLayout();

		expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute('href', '/app');
		expect(screen.getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/checkout');
	});

	it('renders its children as the page content', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderLayout(<p>child content</p>);

		expect(await screen.findByText('child content')).toBeInTheDocument();
	});

	it('shows the empty-state copy when given no children', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderLayout();

		expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument();
	});
});
