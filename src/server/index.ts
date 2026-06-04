import { serve } from '@hono/node-server';
import { app } from './app';
import { db } from '@/db/client';
import { env } from '@/env';
import { logger } from '@/server/logger';
import { startWorkers, stopWorkers } from '@/server/workers/start';

// Importing `env` validates the server environment at boot; a missing or malformed
// required variable (e.g. DATABASE_URL) aborts in `src/env.ts` before we get here.
const PORT = 3000;
// Hard cap on graceful shutdown: if in-flight requests / the pool don't drain in
// time, force-exit so an orchestrator's SIGKILL isn't what stops us.
const SHUTDOWN_TIMEOUT_MS = 5000;

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	logger.info({ env: env.NODE_ENV, port: info.port }, 'server listening');
});

// Periodic housekeeping (auth-code/session expiry, rate-limit-counter GC) runs
// ONLY in this production entry — never under test, so importing `app` in-process
// never spawns timers.
startWorkers();

let shuttingDown = false;

/**
 * Graceful shutdown: stop the workers, stop accepting connections and let in-
 * flight requests drain, close the DB pool, then exit. A hard timeout forces exit
 * if anything hangs. Wired to SIGTERM (orchestrator stop / redeploy) and SIGINT
 * (Ctrl-C in dev). Guarded so a second signal doesn't re-enter.
 */
function shutdown(signal: NodeJS.Signals): void {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info({ signal }, 'shutting down');

	const forceExit = setTimeout(() => {
		logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'shutdown timed out — forcing exit');
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	// Don't let the timeout itself keep the process alive once everything is done.
	forceExit.unref();

	stopWorkers();

	server.close((err) => {
		if (err) {
			logger.error({ err }, 'error closing server');
		}
		// Drain the connection pool last, after the server stops accepting requests.
		db.$client
			.end()
			.catch((poolErr: unknown) => {
				logger.error({ err: poolErr }, 'error closing database pool');
			})
			.finally(() => {
				clearTimeout(forceExit);
				process.exit(err ? 1 : 0);
			});
	});
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
