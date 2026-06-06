import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide TanStack Query client. Mounted via `QueryClientProvider` in
 * `main.tsx` as the outermost provider.
 */
export const queryClient = new QueryClient();
