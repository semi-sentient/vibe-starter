import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/web/components/ErrorBoundary';

/** A child that always throws during render, to trip the boundary. */
function Boom(): never {
	throw new Error('boom');
}

describe('<ErrorBoundary />', () => {
	// React logs the caught render error to console.error (twice in dev), and the
	// boundary itself logs via console.error. That noise is expected here, so
	// silence it for these tests rather than letting it clutter the run.
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders children when nothing throws', () => {
		render(
			<ErrorBoundary>
				<p>all good</p>
			</ErrorBoundary>
		);

		expect(screen.getByText('all good')).toBeInTheDocument();
	});

	it('shows the recovery UI instead of crashing when a child throws', () => {
		// The render does NOT throw out of the boundary — if it did, this call would
		// reject and fail the test. Reaching the assertions proves the boundary caught it.
		render(
			<ErrorBoundary>
				<Boom />
			</ErrorBoundary>
		);

		expect(screen.getByText('Something went wrong. Please reload.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
	});
});
