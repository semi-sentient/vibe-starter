import { useAuth } from '@/web/auth/AuthProvider';
import { Button } from '@/web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/web/components/ui/card';
import { useNavigate } from 'react-router';

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
		<main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-6 md:p-8">
			<Card>
				<CardHeader>
					<h1 className="text-2xl leading-none font-semibold">You&apos;re signed in</h1>
					<CardDescription>
						Signed in as <strong>{user?.email}</strong>
						{user?.role === 'admin' ? ' (admin)' : null}.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button onClick={() => void handleSignOut()} type="button" variant="outline">
						Sign out
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}
