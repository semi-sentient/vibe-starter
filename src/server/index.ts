import { serve } from '@hono/node-server';
import { env } from '@/env';
import { app } from './app';

// Importing `env` validates the server environment at boot; a missing or malformed
// required variable (e.g. DATABASE_URL) throws here before the server starts.
const PORT = 3000;

serve({ fetch: app.fetch, port: PORT }, (info) => {
	// eslint-disable-next-line no-console -- structured logging arrives in a later phase.
	console.log(`[server] ${env.NODE_ENV} — listening on http://localhost:${info.port}`);
});
