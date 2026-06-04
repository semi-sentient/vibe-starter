import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { csrf } from '@/auth/csrf';
import { env } from '@/env';

/** A throwaway app with `csrf()` mounted globally and a couple of routes. */
function harness(exemptPaths?: string[]) {
	const app = new Hono();
	app.use('*', csrf({ exemptPaths }));
	app.get('/read', (c) => c.json({ ok: true }));
	app.post('/write', (c) => c.json({ ok: true }));
	app.post('/api/stripe/webhook', (c) => c.json({ ok: true }));
	return app;
}

describe('csrf', () => {
	it('allows GET regardless of Origin', async () => {
		const res = await harness().request('/read', {
			headers: { origin: 'https://evil.example' },
		});
		expect(res.status).toBe(200);
	});

	it('allows a non-GET request whose Origin matches APP_ORIGIN', async () => {
		const res = await harness().request('/write', {
			headers: { origin: env.APP_ORIGIN },
			method: 'POST',
		});
		expect(res.status).toBe(200);
	});

	it('rejects a non-GET request with a mismatched Origin (403)', async () => {
		const res = await harness().request('/write', {
			headers: { origin: 'https://evil.example' },
			method: 'POST',
		});
		expect(res.status).toBe(403);
	});

	it('allows a non-GET request that omits the Origin header', async () => {
		// Same-origin / API / test clients send no Origin; SameSite=Lax + the signed
		// cookie are the primary defense, so a missing Origin is allowed through.
		const res = await harness().request('/write', { method: 'POST' });
		expect(res.status).toBe(200);
	});

	it('exempts a configured path prefix even with a mismatched Origin', async () => {
		// The Stripe webhook (P7) is server-to-server, signature-authenticated, and
		// must bypass the Origin check.
		const res = await harness(['/api/stripe/webhook']).request('/api/stripe/webhook', {
			headers: { origin: 'https://api.stripe.com' },
			method: 'POST',
		});
		expect(res.status).toBe(200);
	});
});
