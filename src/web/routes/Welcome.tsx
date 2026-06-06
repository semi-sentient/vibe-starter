import { useQuery } from '@tanstack/react-query';
import { client } from '@/web/api/client';
import { Button } from '@/web/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/web/components/ui/card';
import { cn } from '@/web/lib/utils';

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
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-6 md:p-8">
			<div className="flex flex-col gap-2">
				<h1 className="text-3xl font-bold tracking-tight md:text-4xl">
					Welcome to vibe-starter
				</h1>
				<p className="text-muted-foreground">
					Your full-stack TypeScript app is wired up and running. Edit this page in{' '}
					<code className="bg-muted rounded px-1 py-0.5 text-sm">
						src/web/routes/Welcome.tsx
					</code>{' '}
					to make it yours.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>System status</CardTitle>
					<CardDescription>
						Live health check through the typed API client.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<section className="flex flex-wrap gap-3" aria-live="polite">
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
				</CardContent>
			</Card>

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<Button asChild>
					<a href="/login">Sign in</a>
				</Button>
				<nav className="text-muted-foreground flex gap-4 text-sm">
					<a
						className="underline-offset-4 hover:underline"
						href="https://github.com/semi-sentient/vibe-starter#readme"
					>
						Read the README
					</a>
					<a
						className="underline-offset-4 hover:underline"
						href="#build-your-first-feature"
					>
						Build your first feature
					</a>
				</nav>
			</div>
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

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium',
				state === 'ok' && 'border-success text-success',
				state === 'pending' && 'border-warning text-warning',
				state === 'error' && 'border-destructive text-destructive'
			)}
		>
			<strong>{label}</strong> {mark} {text}
		</span>
	);
}
