import { logger } from '@/server/logger';
import {
	cleanRateLimitCounters,
	expireAuthCodes,
	expireSessions,
	runPeriodically,
} from '@/server/workers/periodic';

const MINUTE_MS = 60 * 1000;

/** Live interval handles, so `stopWorkers` can clear exactly what `startWorkers` scheduled. */
let handles: NodeJS.Timeout[] = [];

/**
 * Starts the in-process housekeeping workers (auth-code/session expiry, rate-
 * limit-counter GC). Called ONLY from the production entry (`src/server/index.ts`)
 * — never from tests, so importing `app` for an in-process test never spawns
 * timers. Idempotent: a second call while workers are running is a no-op.
 */
export function startWorkers(): void {
	if (handles.length > 0) return;
	handles = [
		runPeriodically('expireAuthCodes', 5 * MINUTE_MS, expireAuthCodes),
		runPeriodically('expireSessions', 15 * MINUTE_MS, expireSessions),
		runPeriodically('cleanRateLimitCounters', 5 * MINUTE_MS, cleanRateLimitCounters),
	];
	logger.info({ workers: handles.length }, 'workers started');
}

/**
 * Stops the workers by clearing every scheduled interval. Called from the
 * `SIGTERM`/`SIGINT` graceful-shutdown path in `index.ts`. Idempotent: safe to
 * call when nothing is running. Does NOT close the DB pool — the entry point owns
 * that, after this returns.
 */
export function stopWorkers(): void {
	for (const handle of handles) {
		clearInterval(handle);
	}
	handles = [];
}
