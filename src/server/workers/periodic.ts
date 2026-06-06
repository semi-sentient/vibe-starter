import { lt, lte } from 'drizzle-orm';
import { db } from '@/db/client';
import { authCodes, rateLimitCounters, sessions } from '@/db/schema';
import { logger } from '@/server/logger';

/**
 * Retention for spent rate-limit counters. The shipped limiter uses a 10-minute
 * window (`rate-limit.ts`), so a counter whose window started over an hour ago is
 * long dead — well past any configured window, so GC never races a live counter
 * (the limiter re-inserts a fresh row on the next hit anyway). Generous on
 * purpose: this is housekeeping, not correctness-critical.
 */
const RATE_LIMIT_COUNTER_TTL_MS = 60 * 60 * 1000;

/** A periodic cleanup job: returns the number of rows it removed (for logging). */
type Worker = () => Promise<number>;

/**
 * Deletes expired magic-link codes (`auth_codes.expires_at <= now`).
 *
 * `verifyCode` already deletes a code on success, expiry-on-read, or attempt
 * exhaustion — this GCs the codes that were requested but simply never used
 * before expiring, so the table doesn't grow unbounded.
 */
export const expireAuthCodes: Worker = async () => {
	const result = await db.delete(authCodes).where(lte(authCodes.expiresAt, new Date()));
	return result.rowCount ?? 0;
};

/**
 * Deletes expired sessions (`sessions.expires_at <= now`).
 *
 * `getSession` slides a live session's expiry forward and ignores expired rows
 * (treating them as logged-out), but leaves them in place; this worker reaps
 * them so the table reflects only active sessions.
 */
export const expireSessions: Worker = async () => {
	const result = await db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
	return result.rowCount ?? 0;
};

/**
 * Deletes long-dead rate-limit counters (`window_start` older than
 * {@link RATE_LIMIT_COUNTER_TTL_MS}). `rate_limit_counters` is the highest-volume
 * housekeeping table (one row per limiter key); this is the GC deferred from P5.
 */
export const cleanRateLimitCounters: Worker = async () => {
	const cutoff = new Date(Date.now() - RATE_LIMIT_COUNTER_TTL_MS);
	const result = await db
		.delete(rateLimitCounters)
		.where(lt(rateLimitCounters.windowStart, cutoff));
	return result.rowCount ?? 0;
};

/**
 * Schedules `fn` to run every `intervalMs`. The first run is deferred by one tick
 * (the plain `setInterval` default), which is fine for housekeeping — there is no
 * eager run on start. Returns the interval handle so the caller can
 * `clearInterval` it on shutdown.
 *
 * Each tick is wrapped so a thrown error (e.g. a transient DB blip) is logged and
 * swallowed — one bad tick must never kill the timer or crash the process. A
 * non-zero deletion count is logged at `info`; an empty run stays quiet (`debug`).
 * The timer is `unref`'d so it never by itself keeps the process alive — graceful
 * shutdown is driven by the signal handlers in `index.ts`, not by these timers.
 */
export function runPeriodically(name: string, intervalMs: number, fn: Worker): NodeJS.Timeout {
	const handle = setInterval(() => {
		void fn()
			.then((removed) => {
				if (removed > 0) {
					logger.info({ removed, worker: name }, 'worker run');
				} else {
					logger.debug({ removed, worker: name }, 'worker run');
				}
			})
			.catch((err: unknown) => {
				logger.error({ err, worker: name }, 'worker failed');
			});
	}, intervalMs);

	handle.unref();
	return handle;
}
