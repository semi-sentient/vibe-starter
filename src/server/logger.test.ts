import { Hono } from 'hono';
import type { Logger } from 'pino';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '@/env';
import { app } from '@/server/app';
import { logger, loggerMiddleware } from '@/server/logger';

/**
 * Logging (P8): `loggerMiddleware` request logs + the body-safety guarantee, plus
 * the real `app.onError`.
 *
 * The root `logger` is `silent` under test, so assertions spy on it: `logger.child`
 * is stubbed to return a child whose `.info`/`.error` we capture. The body-safety
 * test is the load-bearing one — it proves the middleware never reads the request
 * body, which the Stripe webhook's raw-body signature check depends on.
 */

/** Spy on the per-request child the middleware creates. Returns the captured method spies. */
function spyOnRequestLogger() {
	const child = logger.child({});
	const info = vi.spyOn(child, 'info').mockReturnValue(undefined);
	const error = vi.spyOn(child, 'error').mockReturnValue(undefined);
	// pino types `child()` as `Logger<string, boolean>`, but `logger.child({})`
	// resolves to `Logger<never, boolean>` (no custom levels); the two differ only
	// by an unused generic, so cast the stub's return to the method's declared type.
	vi.spyOn(logger, 'child').mockReturnValue(child as unknown as ReturnType<typeof logger.child>);
	return { error, info };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('loggerMiddleware', () => {
	it('logs one structured request line with requestId, path, status, and durationMs', async () => {
		const { info } = spyOnRequestLogger();

		const test = new Hono<{ Variables: { logger: Logger } }>().use('*', loggerMiddleware);
		test.get('/ping', (c) => c.json({ ok: true }));

		const res = await test.request('/ping');
		expect(res.status).toBe(200);

		// The child carries `{ path, requestId }`; the completion line carries
		// `{ durationMs, status }` with the message `request`.
		expect(logger.child).toHaveBeenCalledWith(
			expect.objectContaining({ path: '/ping', requestId: expect.any(String) })
		);
		expect(info).toHaveBeenCalledTimes(1);
		const [fields, message] = info.mock.calls[0] ?? [];
		expect(message).toBe('request');
		expect(fields).toMatchObject({ durationMs: expect.any(Number), status: 200 });
	});

	it('does NOT consume the request body — a downstream route still reads the raw bytes', async () => {
		// This is the webhook-safety contract: if the middleware read the body, the
		// Stripe signature check (HMAC over the exact raw bytes) would break.
		spyOnRequestLogger();

		const test = new Hono<{ Variables: { logger: Logger } }>().use('*', loggerMiddleware);
		let seen: string | null = null;
		test.post('/echo', async (c) => {
			seen = await c.req.text();
			return c.json({ ok: true });
		});

		const raw = '{"id":"evt_123","signed":"bytes"}';
		const res = await test.request('/echo', { body: raw, method: 'POST' });

		expect(res.status).toBe(200);
		expect(seen).toBe(raw);
	});
});

describe('app.onError', () => {
	// A uniquely-namespaced route on the real `app` that always throws, so requests
	// to it exercise the real centralized error handler. Registered once; harmless
	// to other tests (they hit their own paths).
	beforeAll(() => {
		(app as unknown as Hono).get('/__test_error', () => {
			throw new Error('kaboom');
		});
	});

	it('logs the error on the request logger and returns 500 with details outside production', async () => {
		const { error } = spyOnRequestLogger();

		const res = await app.request('/api/__test_error');

		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string; stack?: string };
		expect(body.error).toBe('kaboom');
		expect(body.stack).toEqual(expect.any(String));
		expect(error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			expect.any(String)
		);
	});

	it('returns a generic 500 (no message/stack) in production', async () => {
		spyOnRequestLogger();
		const original = env.NODE_ENV;
		env.NODE_ENV = 'production';
		try {
			const res = await app.request('/api/__test_error');
			expect(res.status).toBe(500);
			expect(await res.json()).toEqual({ error: 'Internal Server Error' });
		} finally {
			env.NODE_ENV = original;
		}
	});
});
