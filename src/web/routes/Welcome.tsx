import { client } from '@/web/api/client';
import { useQuery } from '@tanstack/react-query';

/**
 * Public, unauthenticated landing page mounted at `/`.
 *
 * Doubles as the end-to-end RPC type-safety proof: it calls the typed Hono
 * client (`client.api.health.$get()`) through TanStack Query and reflects the
 * result in live status badges. The `/health` endpoint also probes the database,
 * so the response distinguishes three states the badges mirror:
 *   - fetch rejects (server unreachable)      → API ✗, Database ✗
 *   - 503 `{ db: 'down' }` (server up, DB out) → API ✓, Database ✗
 *   - 200 `{ db: 'up' }`                       → API ✓, Database ✓
 * A 503 is deliberately NOT thrown — it is a real server response, so the query
 * resolves with the parsed body and the API badge stays green.
 * Styling is intentionally minimal — Tailwind + shadcn polish arrives in a later phase.
 */
export function Welcome() {
	const health = useQuery({
		queryFn: async () => {
			// Resolves on any HTTP response (200 or 503); only a network failure rejects.
			const res = await client.api.health.$get();
			return res.json();
		},
		queryKey: ['health'],
	});

	// A resolved query means the server responded at all — that is the API signal.
	const apiConnected = health.isSuccess;
	const dbConnected = health.isSuccess && health.data.db === 'up';

	return (
		<main style={styles.main}>
			<h1 style={styles.heading}>Welcome to vibe-starter</h1>
			<p style={styles.tagline}>
				Your full-stack TypeScript app is wired up and running. Edit this page in{' '}
				<code>src/web/routes/Welcome.tsx</code> to make it yours.
			</p>

			<section style={styles.status} aria-live="polite">
				<StatusBadge
					label="API"
					state={health.isPending ? 'pending' : apiConnected ? 'ok' : 'error'}
					okText="connected"
					pendingText="checking…"
					errorText="unreachable"
				/>
				<StatusBadge
					label="Database"
					state={health.isPending ? 'pending' : dbConnected ? 'ok' : 'error'}
					okText="connected"
					pendingText="checking…"
					errorText="unreachable"
				/>
			</section>

			<div style={styles.actions}>
				{/* Placeholder CTA — the /login route is wired in a later phase. */}
				<a style={styles.primaryButton} href="/login" aria-disabled="true">
					Sign in
				</a>
			</div>

			<nav style={styles.links}>
				<a href="https://github.com/semi-sentient/vibe-starter#readme">Read the README</a>
				<a href="#build-your-first-feature">Build your first feature</a>
			</nav>
		</main>
	);
}

type BadgeState = 'error' | 'ok' | 'pending';

function StatusBadge(props: {
	errorText: string;
	label: string;
	okText: string;
	pendingText: string;
	state: BadgeState;
}) {
	const { errorText, label, okText, pendingText, state } = props;
	const text = state === 'ok' ? okText : state === 'pending' ? pendingText : errorText;
	const mark = state === 'ok' ? '✓' : state === 'pending' ? '…' : '✕';
	const color = state === 'ok' ? '#15803d' : state === 'pending' ? '#a16207' : '#b91c1c';

	return (
		<span style={{ ...styles.badge, borderColor: color, color }}>
			<strong>{label}</strong> {mark} {text}
		</span>
	);
}

const styles: Record<string, React.CSSProperties> = {
	actions: {
		display: 'flex',
		gap: '0.75rem',
		marginBottom: '1.5rem',
	},
	badge: {
		border: '1px solid',
		borderRadius: '9999px',
		display: 'inline-flex',
		fontSize: '0.875rem',
		gap: '0.375rem',
		padding: '0.25rem 0.75rem',
	},
	heading: {
		fontSize: '2rem',
		marginBottom: '0.5rem',
	},
	links: {
		display: 'flex',
		gap: '1.5rem',
		fontSize: '0.875rem',
	},
	main: {
		fontFamily: 'system-ui, sans-serif',
		lineHeight: 1.5,
		margin: '0 auto',
		maxWidth: '42rem',
		padding: '3rem 1.5rem',
	},
	primaryButton: {
		background: '#111827',
		borderRadius: '0.5rem',
		color: '#fff',
		display: 'inline-block',
		padding: '0.5rem 1rem',
		textDecoration: 'none',
	},
	status: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '0.75rem',
		margin: '1.5rem 0',
	},
	tagline: {
		color: '#374151',
		marginBottom: '0.5rem',
	},
};
