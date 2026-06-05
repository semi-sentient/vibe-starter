import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from '@/web/auth/AuthProvider';
import { server } from '@/web/test/msw-server';

function renderWithProviders(ui: ReactElement) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<AuthProvider>{ui}</AuthProvider>
		</QueryClientProvider>
	);
}

/** A probe that renders the current auth state for assertions. */
function AuthProbe() {
	const { isLoading, login, logout, user } = useAuth();
	if (isLoading) return <p>loading</p>;
	return (
		<div>
			<p>user: {user ? user.email : 'none'}</p>
			<button onClick={() => void login('person@example.com', '123456')}>do-login</button>
			<button onClick={() => void logout()}>do-logout</button>
		</div>
	);
}

describe('AuthProvider', () => {
	it('resolves to no user when /api/auth/me returns 401', async () => {
		server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })));

		renderWithProviders(<AuthProbe />);

		expect(await screen.findByText('user: none')).toBeInTheDocument();
	});

	it('exposes the user when /api/auth/me returns one', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			)
		);

		renderWithProviders(<AuthProbe />);

		expect(await screen.findByText('user: her@example.com')).toBeInTheDocument();
	});

	it('login() verifies a code and populates the user', async () => {
		server.use(
			http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
			http.post('/api/auth/verify', () =>
				HttpResponse.json({ user: { email: 'person@example.com', id: 7, role: 'user' } })
			)
		);
		const user = userEvent.setup();
		renderWithProviders(<AuthProbe />);
		await screen.findByText('user: none');

		await user.click(screen.getByRole('button', { name: 'do-login' }));

		expect(await screen.findByText('user: person@example.com')).toBeInTheDocument();
	});

	it('logout() clears the user', async () => {
		server.use(
			http.get('/api/auth/me', () =>
				HttpResponse.json({ user: { email: 'her@example.com', id: 1, role: 'user' } })
			),
			http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 }))
		);
		const user = userEvent.setup();
		renderWithProviders(<AuthProbe />);
		await screen.findByText('user: her@example.com');

		await user.click(screen.getByRole('button', { name: 'do-logout' }));

		await waitFor(() => expect(screen.getByText('user: none')).toBeInTheDocument());
	});
});
