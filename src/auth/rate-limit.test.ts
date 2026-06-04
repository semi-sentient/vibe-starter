import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { clientIp, rateLimit } from '@/auth/rate-limit';
import { db } from '@/db/client';
import { rateLimitCounters } from '@/db/schema';

/** A throwaway app limited to `limit` hits per `window` ms on a fixed key. */
function harness(opts: { key?: string; limit?: number; window?: number } = {}) {
	const app = new Hono();
	app.post(
		'/hit',
		rateLimit({
			key: opts.key ?? 'test:fixed',
			limit: opts.limit ?? 3,
			window: opts.window ?? 60_000,
		}),
		(c) => c.json({ ok: true })
	);
	return app;
}

describe('rateLimit', () => {
	it('allows requests up to the limit, then rejects with 429', async () => {
		const app = harness({ limit: 3 });

		for (let i = 0; i < 3; i += 1) {
			expect((await app.request('/hit', { method: 'POST' })).status).toBe(200);
		}
		// The 4th request in the window is over the limit.
		expect((await app.request('/hit', { method: 'POST' })).status).toBe(429);
	});

	it('resets the counter once the window has elapsed', async () => {
		const app = harness({ key: 'test:reset', limit: 2, window: 60_000 });

		await app.request('/hit', { method: 'POST' });
		await app.request('/hit', { method: 'POST' });
		expect((await app.request('/hit', { method: 'POST' })).status).toBe(429);

		// Backdate the window so the next request starts a fresh window.
		await db
			.update(rateLimitCounters)
			.set({ windowStart: new Date(Date.now() - 61_000) })
			.where(eq(rateLimitCounters.key, 'test:reset'));

		const after = await app.request('/hit', { method: 'POST' });
		expect(after.status).toBe(200);
		// Counter restarted at 1 for the new window.
		const [row] = await db
			.select()
			.from(rateLimitCounters)
			.where(eq(rateLimitCounters.key, 'test:reset'));
		expect(row?.count).toBe(1);
	});

	it('accepts a key function computed from the request', async () => {
		const app = new Hono();
		app.post(
			'/hit',
			rateLimit({ key: async (c) => `byname:${(await c.req.json()).name}`, limit: 1 }),
			(c) => c.json({ ok: true })
		);

		const body = (name: string) => ({
			body: JSON.stringify({ name }),
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});
		// Distinct keys are limited independently.
		expect((await app.request('/hit', body('alice'))).status).toBe(200);
		expect((await app.request('/hit', body('bob'))).status).toBe(200);
		// Second hit for the same key is over its limit of 1.
		expect((await app.request('/hit', body('alice'))).status).toBe(429);
	});
});

describe('clientIp', () => {
	it('uses the left-most X-Forwarded-For hop when present', async () => {
		const app = new Hono();
		app.get('/ip', (c) => c.json({ ip: clientIp(c) }));

		const res = await app.request('/ip', {
			headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
		});
		expect(await res.json()).toEqual({ ip: '203.0.113.7' });
	});

	it('falls back to a stable placeholder when no IP source is available', async () => {
		const app = new Hono();
		app.get('/ip', (c) => c.json({ ip: clientIp(c) }));

		// No X-Forwarded-For and no socket info (app.request has no conn info).
		const res = await app.request('/ip');
		expect(await res.json()).toEqual({ ip: 'unknown' });
	});
});
