import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from '@/web/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/web/components/ui/card';

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	error: Error | null;
}

/**
 * Root-level error boundary. Function components cannot catch render errors, so
 * this must be a class component: `getDerivedStateFromError` swaps in the
 * fallback UI and `componentDidCatch` logs the error.
 *
 * Scope: catches errors thrown during render of its subtree only. It does NOT
 * catch errors in event handlers, async code, or effects — those surface through
 * TanStack Query's error states (the dominant async case) instead. Mounted in
 * `main.tsx` above the app so an uncaught render error shows a recovery UI rather
 * than a white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		// No real logging service yet (added in a later phase) — go to the console.
		console.error('Uncaught render error:', error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return <ErrorPage error={this.state.error} />;
		}
		return this.props.children;
	}
}

/**
 * The boundary's fallback. User-friendly message plus a Reload action; the raw
 * stack is shown only in development to aid debugging without leaking internals
 * to end users in production.
 */
function ErrorPage({ error }: { error: Error }) {
	return (
		<main className="bg-background flex min-h-screen items-center justify-center p-4 md:p-8">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Something went wrong. Please reload.</CardTitle>
					<CardDescription>
						An unexpected error occurred while rendering this page.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{import.meta.env.DEV ? (
						<pre className="bg-muted text-muted-foreground max-h-64 overflow-auto rounded-md p-3 text-xs">
							{error.stack ?? error.message}
						</pre>
					) : null}
					<Button onClick={() => window.location.reload()} type="button">
						Reload
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}
