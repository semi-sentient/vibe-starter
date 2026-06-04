import { AuthProvider } from '@/web/auth/AuthProvider';
import { Layout } from '@/web/components/Layout';
import { server } from '@/web/test/msw-server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

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
