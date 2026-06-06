import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Welcome } from '@/web/routes/Welcome';
import { server } from '@/web/test/msw-server';

// A fresh, retry-free QueryClient per render so the cache never leaks between
// tests and a failed query surfaces immediately instead of being retried.
function renderWithQuery(ui: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('<Welcome />', () => {
	it('renders the landing page and reflects a healthy API + database', async () => {
		server.use(http.get('/api/health', () => HttpResponse.json({ db: 'up', status: 'ok' })));

		renderWithQuery(<Welcome />);

		// Static content proves the component mounted in happy-dom.
		expect(
			screen.getByRole('heading', { name: /welcome to vibe-starter/i })
		).toBeInTheDocument();

		// The async health round-trip (render -> fetch -> MSW -> query resolves ->
		// re-render) flips both the API and Database badges to "connected". Each
		// badge's text is "<label> ✓ connected", so match the "connected" substring
		// (a regex) rather than an exact-text match, and expect both badges.
		const connected = await screen.findAllByText(/connected/);
		expect(connected).toHaveLength(2);
	});
});
