import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CheckoutCancel } from '@/web/routes/CheckoutCancel';

function renderCancel() {
	return render(
		<MemoryRouter initialEntries={['/checkout/cancel']}>
			<CheckoutCancel />
		</MemoryRouter>
	);
}

describe('<CheckoutCancel />', () => {
	it('tells the user the checkout was cancelled and offers a way back', () => {
		renderCancel();

		expect(screen.getByText('Checkout cancelled')).toBeInTheDocument();
		expect(
			screen.getByText('No charge was made. You can try again whenever you’re ready.')
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Back to checkout' })).toHaveAttribute(
			'href',
			'/checkout'
		);
	});
});
