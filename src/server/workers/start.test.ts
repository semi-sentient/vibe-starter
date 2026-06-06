import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWorkers, stopWorkers } from '@/server/workers/start';

afterEach(() => {
	// Always clear whatever a test scheduled so intervals never leak into the rest
	// of the suite (they are `unref`'d, but reaping them keeps the run clean).
	stopWorkers();
	vi.restoreAllMocks();
});

describe('startWorkers / stopWorkers', () => {
	it('schedules the three cleanup jobs', () => {
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

		startWorkers();

		expect(setIntervalSpy).toHaveBeenCalledTimes(3);
	});

	it('is idempotent — a second startWorkers does not double-schedule', () => {
		startWorkers();
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

		startWorkers();

		expect(setIntervalSpy).not.toHaveBeenCalled();
	});

	it('stopWorkers clears every scheduled interval and lets a fresh start run again', () => {
		startWorkers();
		const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

		stopWorkers();
		expect(clearIntervalSpy).toHaveBeenCalledTimes(3);

		// After a stop, the guard is reset, so starting again schedules afresh.
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
		startWorkers();
		expect(setIntervalSpy).toHaveBeenCalledTimes(3);
	});
});
