import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { authCodes, rateLimitCounters, sessions } from '@/db/schema';
import { logger } from '@/server/logger';
import { createUser } from '@/server/test/factories/users';
import {
	cleanRateLimitCounters,
	expireAuthCodes,
	expireSessions,
	runPeriodically,
} from '@/server/workers/periodic';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('expireAuthCodes', () => {
	it('deletes only codes whose expiry has passed', async () => {
		await db.insert(authCodes).values([
			{
				code: '111111',
				email: 'expired@example.com',
				expiresAt: new Date(Date.now() - MINUTE_MS),
			},
			{
				code: '222222',
				email: 'live@example.com',
				expiresAt: new Date(Date.now() + MINUTE_MS),
			},
		]);

		const removed = await expireAuthCodes();

		expect(removed).toBe(1);
		const remaining = await db.select().from(authCodes);
		expect(remaining.map((r) => r.email)).toEqual(['live@example.com']);
	});
});

describe('expireSessions', () => {
	it('deletes only sessions whose expiry has passed', async () => {
		const user = await createUser();
		await db.insert(sessions).values([
			{ expiresAt: new Date(Date.now() - MINUTE_MS), id: 'expired-sid', userId: user.id },
			{ expiresAt: new Date(Date.now() + MINUTE_MS), id: 'live-sid', userId: user.id },
		]);

		const removed = await expireSessions();

		expect(removed).toBe(1);
		const remaining = await db.select().from(sessions);
		expect(remaining.map((r) => r.id)).toEqual(['live-sid']);
	});
});

describe('cleanRateLimitCounters', () => {
	it('deletes only counters older than the retention window, keeping recent ones', async () => {
		await db.insert(rateLimitCounters).values([
			{ count: 5, key: 'old', windowStart: new Date(Date.now() - 2 * HOUR_MS) },
			{ count: 1, key: 'recent', windowStart: new Date(Date.now() - MINUTE_MS) },
		]);

		const removed = await cleanRateLimitCounters();

		expect(removed).toBe(1);
		const remaining = await db.select().from(rateLimitCounters);
		expect(remaining.map((r) => r.key)).toEqual(['recent']);
	});
});

describe('runPeriodically', () => {
	it('invokes the job on each interval tick', async () => {
		vi.useFakeTimers();
		const fn = vi.fn().mockResolvedValue(0);

		const handle = runPeriodically('test', 1000, fn);
		try {
			expect(fn).not.toHaveBeenCalled(); // no eager run
			await vi.advanceTimersByTimeAsync(1000);
			expect(fn).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1000);
			expect(fn).toHaveBeenCalledTimes(2);
		} finally {
			clearInterval(handle);
		}
	});

	it('swallows a thrown error (logs it) so the timer survives a bad tick', async () => {
		vi.useFakeTimers();
		const err = vi.spyOn(logger, 'error').mockReturnValue(undefined);
		const fn = vi.fn().mockRejectedValueOnce(new Error('tick failed')).mockResolvedValueOnce(3);

		const handle = runPeriodically('flaky', 1000, fn);
		try {
			await vi.advanceTimersByTimeAsync(1000);
			expect(err).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error), worker: 'flaky' }),
				expect.any(String)
			);
			// Timer survived: the next tick still runs.
			await vi.advanceTimersByTimeAsync(1000);
			expect(fn).toHaveBeenCalledTimes(2);
		} finally {
			clearInterval(handle);
		}
	});
});
