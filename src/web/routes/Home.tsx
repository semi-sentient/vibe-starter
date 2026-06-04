import { Link, useNavigate } from 'react-router';
import { useAuth } from '@/web/auth/AuthProvider';
import { Button } from '@/web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/web/components/ui/card';

/**
 * The signed-in landing page (`/app`), shown after a successful login. The
 * public Welcome page stays at `/`. Greets the user and offers `Sign out`,
 * which ends the session and returns to the public home.
 */
export function Home() {
	const { logout, user } = useAuth();
	const navigate = useNavigate();

	async function handleSignOut() {
		await logout();
		void navigate('/');
	}

	return (
		<div className="mx-auto flex max-w-lg flex-col">
			<Card>
				<CardHeader>
					<h1 className="text-2xl leading-none font-semibold">You&apos;re signed in</h1>
					<CardDescription>
						Signed in as <strong>{user?.email}</strong>
						{user?.role === 'admin' ? ' (admin)' : null}.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 sm:flex-row">
					<Button asChild>
						<Link to="/checkout">Buy a sample item</Link>
					</Button>
					<Button onClick={() => void handleSignOut()} type="button" variant="outline">
						Sign out
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
