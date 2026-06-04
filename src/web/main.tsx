import { App } from '@/web/App';
import { queryClient } from '@/web/api/query';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Root element #root not found in index.html');
}

// Provider nesting (outer -> inner): QueryClientProvider -> BrowserRouter -> App.
// Later phases insert an ErrorBoundary and an AuthProvider into this tree.
createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>
);
