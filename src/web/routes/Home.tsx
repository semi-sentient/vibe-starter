import { useAuth } from '@/web/auth/AuthProvider';
import { useNavigate } from 'react-router';

/**
 * The signed-in landing page (`/app`), shown after a successful login. The
 * public Welcome page stays at `/`. Greets the user and offers `Sign out`,
 * which ends the session and returns to the public home.
 *
 * Intentionally minimal — Tailwind + shadcn polish arrive in P6.
 */
export function Home() {
	const { logout, user } = useAuth();
	const navigate = useNavigate();

	async function handleSignOut() {
		await logout();
		void navigate('/');
	}

	return (
		<main style={styles.main}>
			<h1 style={styles.heading}>You're signed in</h1>
			<p style={styles.body}>
				Signed in as <strong>{user?.email}</strong>
				{user?.role === 'admin' ? ' (admin)' : null}.
			</p>
			<button onClick={() => void handleSignOut()} style={styles.button} type="button">
				Sign out
			</button>
		</main>
	);
}

const styles: Record<string, React.CSSProperties> = {
	body: {
		color: '#374151',
		marginBottom: '1.5rem',
	},
	button: {
		background: '#111827',
		border: 'none',
		borderRadius: '0.5rem',
		color: '#fff',
		cursor: 'pointer',
		padding: '0.5rem 1rem',
	},
	heading: {
		fontSize: '1.5rem',
		marginBottom: '0.5rem',
	},
	main: {
		fontFamily: 'system-ui, sans-serif',
		margin: '0 auto',
		maxWidth: '32rem',
		padding: '3rem 1.5rem',
	},
};
