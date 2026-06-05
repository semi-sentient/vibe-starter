import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '@/web/auth/AuthProvider';
import { Login } from '@/web/routes/Login';
import { server } from '@/web/test/msw-server';

// Render Login inside the providers it needs, with a stub authed-home route so a
// successful sign-in's redirect is observable.
function renderLogin() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<MemoryRouter initialEntries={['/login']}>
					<Routes>
						<Route path="/login" element={<Login />} />
						<Route path="/app" element={<p>Signed in home</p>} />
					</Routes>
				</MemoryRouter>
			</AuthProvider>
		</QueryClientProvider>
	);
}

describe('<Login />', () => {
	it('renders the email step with the exact PRD copy', () => {
		renderLogin();

		expect(
			screen.getByRole('heading', { name: 'Sign in to vibe-starter' })
		).toBeInTheDocument();
		expect(screen.getByLabelText('Email')).toHaveAttribute('placeholder', 'you@example.com');
		expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument();
	});

	it('shows a validation error for an invalid email', async () => {
		const user = userEvent.setup();
		renderLogin();

		await user.type(screen.getByLabelText('Email'), 'nope');
		await user.click(screen.getByRole('button', { name: 'Send code' }));

		expect(await screen.findByText('Please enter a valid email address.')).toBeInTheDocument();
	});

	it('advances to the code step after requesting a code', async () => {
		const user = userEvent.setup();
		server.use(http.post('/api/auth/request-code', () => HttpResponse.json({ ok: true })));
		renderLogin();

		await user.type(screen.getByLabelText('Email'), 'person@example.com');
		await user.click(screen.getByRole('button', { name: 'Send code' }));

		const codeInput = await screen.findByLabelText('Verification code');
		expect(codeInput).toHaveAttribute('placeholder', '6-digit code');
		expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});

	it('redirects to the authed home on a successful verify', async () => {
		server.use(
			http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
			http.post('/api/auth/request-code', () => HttpResponse.json({ ok: true })),
			http.post('/api/auth/verify', () =>
				HttpResponse.json({ user: { email: 'person@example.com', id: 1, role: 'user' } })
			)
		);
		const user = userEvent.setup();
		renderLogin();

		await user.type(screen.getByLabelText('Email'), 'person@example.com');
		await user.click(screen.getByRole('button', { name: 'Send code' }));

		await user.type(await screen.findByLabelText('Verification code'), '123456');
		await user.click(screen.getByRole('button', { name: 'Sign in' }));

		expect(await screen.findByText('Signed in home')).toBeInTheDocument();
	});

	it('shows the invalid-code error when verify fails', async () => {
		server.use(
			http.post('/api/auth/request-code', () => HttpResponse.json({ ok: true })),
			http.post('/api/auth/verify', () => new HttpResponse(null, { status: 401 }))
		);
		const user = userEvent.setup();
		renderLogin();

		await user.type(screen.getByLabelText('Email'), 'person@example.com');
		await user.click(screen.getByRole('button', { name: 'Send code' }));

		await user.type(await screen.findByLabelText('Verification code'), '000000');
		await user.click(screen.getByRole('button', { name: 'Sign in' }));

		expect(
			await screen.findByText('That code is incorrect or has expired. Please try again.')
		).toBeInTheDocument();
	});
});
