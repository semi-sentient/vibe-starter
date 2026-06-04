import { App } from '@/web/App';
import { queryClient } from '@/web/api/query';
import { AuthProvider } from '@/web/auth/AuthProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element #root not found in index.html');
}

// Provider nesting (outer -> inner): QueryClientProvider -> AuthProvider ->
// BrowserRouter -> App. AuthProvider sits inside QueryClientProvider (it uses
// TanStack Query to resolve the session) and outside the router (so every route
// can read `useAuth()`). A later phase inserts an ErrorBoundary into this tree.
createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<AuthProvider>
				<BrowserRouter>
					<App />
				</BrowserRouter>
			</AuthProvider>
		</QueryClientProvider>
	</StrictMode>
);
