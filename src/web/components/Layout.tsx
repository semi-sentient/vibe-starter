import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/web/auth/AuthProvider';
import { Button } from '@/web/components/ui/button';

interface LayoutProps {
	children?: ReactNode;
}

/**
 * App shell for the authenticated area: a responsive top nav showing the current
 * user and a "Sign out" action, with the routed page rendered below. Signing out
 * ends the session via `useAuth().logout` and returns to the public home (`/`).
 *
 * When given no children it shows a neutral empty state, so a freshly scaffolded
 * authed route still renders something sensible.
 */
export function Layout({ children }: LayoutProps) {
	const { logout, user } = useAuth();
	const navigate = useNavigate();

	async function handleSignOut() {
		await logout();
		void navigate('/');
	}

	return (
		<div className="bg-background text-foreground flex min-h-screen flex-col">
			<header className="border-b">
				<nav className="mx-auto flex w-full max-w-5xl flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between md:p-6">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
						<span className="font-semibold">vibe-starter</span>
						<Button asChild variant="ghost">
							<Link to="/app">Home</Link>
						</Button>
						<Button asChild variant="ghost">
							<Link to="/checkout">Checkout</Link>
						</Button>
					</div>
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
						{user ? (
							<span className="text-muted-foreground text-sm">{user.email}</span>
						) : null}
						<Button
							onClick={() => void handleSignOut()}
							type="button"
							variant="outline"
						>
							Sign out
						</Button>
					</div>
				</nav>
			</header>

			<main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
				{children ?? <p className="text-muted-foreground">Nothing here yet.</p>}
			</main>
		</div>
	);
}
