import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { queryClient } from '@/web/api/query';
import { App } from '@/web/App';
import { AuthProvider } from '@/web/auth/AuthProvider';
import { ErrorBoundary } from '@/web/components/ErrorBoundary';
import '@/web/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element #root not found in index.html');
}

// Provider nesting (outer -> inner): QueryClientProvider -> BrowserRouter ->
// ErrorBoundary -> AuthProvider -> App.
//   - QueryClientProvider + BrowserRouter wrap the boundary so its fallback can
//     use query/navigation hooks.
//   - ErrorBoundary catches render errors in everything below it, including
//     AuthProvider, so auth render failures show the recovery UI too. Its
//     fallback deliberately depends on neither auth nor the router.
//   - AuthProvider stays inside QueryClientProvider (it resolves the session via
//     TanStack Query) and wraps App so every route can read `useAuth()`.
createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<ErrorBoundary>
					<AuthProvider>
						<App />
					</AuthProvider>
				</ErrorBoundary>
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>
);
