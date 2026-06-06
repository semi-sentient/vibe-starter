import { hc } from 'hono/client';
import { clientEnv } from '@/env.client';
import type { AppType } from '@/server/app';

/**
 * Typed Hono RPC client. Pointed at the ORIGIN (default `/`) because the server
 * mounts everything under `.basePath('/api')`, so the typed paths already include
 * `/api` — e.g. `client.api.health.$get()` hits `/api/health`. In dev, the `/`
 * base lets Vite's proxy forward `/api/*` to the Hono server on :3000.
 *
 * `credentials: 'include'` sends the session cookie (used once auth lands).
 */
export const client = hc<AppType>(clientEnv.VITE_API_URL, {
	init: { credentials: 'include' },
});
