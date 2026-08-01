import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { VersionStamp } from '@/web/components/VersionStamp';
import { server } from '@/web/test/msw-server';

// A fresh, retry-free QueryClient per render so the cache never leaks between
// tests and a failed query surfaces immediately instead of being retried.
function renderWithQuery(ui: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// A live sibling next to the stamp. "Renders nothing" is only meaningful if the
// surrounding tree survived: a component that throws during render also leaves an
// empty container behind, and React unmounts the root rather than rethrowing.
function Probe() {
	return (
		<>
			<VersionStamp />
			<p>probe</p>
		</>
	);
}

describe('<VersionStamp />', () => {
	it('shows the version and short SHA when the health query resolves', async () => {
		server.use(
			http.get('/api/health', () =>
				HttpResponse.json({ db: 'up', sha: 'abcdef1', status: 'ok', version: '9.9.9' })
			)
		);

		renderWithQuery(<VersionStamp />);

		expect(await screen.findByText('v9.9.9 (abcdef1)')).toBeInTheDocument();
	});

	it('shows the version alone when the deploy SHA is unknown', async () => {
		server.use(
			http.get('/api/health', () =>
				HttpResponse.json({ db: 'up', sha: null, status: 'ok', version: '9.9.9' })
			)
		);

		renderWithQuery(<VersionStamp />);

		expect(await screen.findByText('v9.9.9')).toBeInTheDocument();
	});

	it('renders nothing while the health query is still pending', () => {
		// `delay('infinite')` keeps the query pending for the whole test, so nothing
		// can resolve late and re-render outside `act`.
		server.use(http.get('/api/health', () => delay('infinite')));

		renderWithQuery(<Probe />);

		// The probe proves the tree is alive — without it, a VersionStamp that THREW
		// would also leave an empty container and pass this test.
		expect(screen.getByText('probe')).toBeInTheDocument();
		expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
	});

	it('renders nothing when the health request fails', async () => {
		server.use(http.get('/api/health', () => HttpResponse.error()));

		renderWithQuery(<Probe />);

		// The query has to actually settle into its error state before the assertion
		// means anything, so wait for a stamp that must never appear.
		await expect(screen.findByText(/^v/)).rejects.toThrow();
		expect(screen.getByText('probe')).toBeInTheDocument();
	});
});
