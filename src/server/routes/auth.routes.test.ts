import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { authCodes } from '@/db/schema';
import { env } from '@/env';
import { createTestServer } from '@/server/test/helpers/createTestServer';

// Magic-link sending falls back to console in tests (no RESEND_API_KEY); silence it.
beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
});

/** Reads the issued (random) 6-digit code straight from the DB. */
async function issuedCodeFor(email: string): Promise<string> {
	const [row] = await db.select().from(authCodes).where(eq(authCodes.email, email));
	if (!row) throw new Error(`no auth_code row for ${email}`);
	return row.code;
}

const json = { 'content-type': 'application/json' };

describe('auth routes — magic-link happy path (anchor)', () => {
	it('request-code → verify → session cookie → GET /api/auth/me returns the user', async () => {
		const server = createTestServer();
		const email = 'anchor@example.com';

		// 1. Request a code. Open signup: any valid email → 200 { ok: true }.
		const requested = await server.request('/api/auth/request-code', {
			body: JSON.stringify({ email }),
			headers: json,
			method: 'POST',
		});
		expect(requested.status).toBe(200);
		expect(await requested.json()).toEqual({ ok: true });

		// 2. Verify the code. Sets the signed `sid` cookie (folded into the jar).
		const code = await issuedCodeFor(email);
		const verified = await server.request('/api/auth/verify', {
			body: JSON.stringify({ code, email }),
			headers: json,
			method: 'POST',
		});
		expect(verified.status).toBe(200);
		expect(verified.headers.getSetCookie().some((c) => c.startsWith('sid='))).toBe(true);

		// 3. GET /me — the jar auto-sends `sid`; the server resolves the session.
		const me = await server.request('/api/auth/me');
		expect(me.status).toBe(200);
		const body = (await me.json()) as { user: { email: string; role: string } };
		expect(body.user.email).toBe(email);
		expect(body.user.role).toBe('user');
	});
});

describe('auth routes — edge cases', () => {
	async function login(server: ReturnType<typeof createTestServer>, email: string) {
		await server.request('/api/auth/request-code', {
			body: JSON.stringify({ email }),
			headers: json,
			method: 'POST',
		});
		const code = await issuedCodeFor(email);
		await server.request('/api/auth/verify', {
			body: JSON.stringify({ code, email }),
			headers: json,
			method: 'POST',
		});
	}

	it('GET /api/auth/me returns 401 with no session', async () => {
		const res = await createTestServer().request('/api/auth/me');
		expect(res.status).toBe(401);
	});

	it('POST /api/auth/verify returns 401 for a wrong code', async () => {
		const server = createTestServer();
		await server.request('/api/auth/request-code', {
			body: JSON.stringify({ email: 'wrong@example.com' }),
			headers: json,
			method: 'POST',
		});

		const res = await server.request('/api/auth/verify', {
			body: JSON.stringify({ code: 'nope-00', email: 'wrong@example.com' }),
			headers: json,
			method: 'POST',
		});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			error: 'That code is incorrect or has expired. Please try again.',
		});
	});

	it('POST /api/auth/logout clears the session (204) so /me is 401 again', async () => {
		const server = createTestServer();
		await login(server, 'bye@example.com');
		expect((await server.request('/api/auth/me')).status).toBe(200);

		const out = await server.request('/api/auth/logout', { method: 'POST' });
		expect(out.status).toBe(204);

		// The jar dropped the cleared cookie; /me is unauthenticated again.
		expect((await server.request('/api/auth/me')).status).toBe(401);
	});

	it('POST /api/auth/request-code returns 400 for an invalid email', async () => {
		const res = await createTestServer().request('/api/auth/request-code', {
			body: JSON.stringify({ email: 'not-an-email' }),
			headers: json,
			method: 'POST',
		});
		expect(res.status).toBe(400);
	});
});

describe('auth routes — rate limiting & CSRF (mounted middleware)', () => {
	it('rate-limits request-code after 5 requests per (ip, email) window → 429', async () => {
		const server = createTestServer();
		const body = {
			body: JSON.stringify({ email: 'flood@example.com' }),
			headers: json,
			method: 'POST',
		} as const;

		// 5 allowed within the window.
		for (let i = 0; i < 5; i += 1) {
			expect((await server.request('/api/auth/request-code', body)).status).toBe(200);
		}
		// The 6th is over the limit.
		expect((await server.request('/api/auth/request-code', body)).status).toBe(429);
	});

	it('keys the limit by email, so a different email is unaffected', async () => {
		const server = createTestServer();
		const post = (email: string) =>
			server.request('/api/auth/request-code', {
				body: JSON.stringify({ email }),
				headers: json,
				method: 'POST',
			});

		for (let i = 0; i < 5; i += 1) await post('a@example.com');
		expect((await post('a@example.com')).status).toBe(429);
		// A different email starts its own window.
		expect((await post('b@example.com')).status).toBe(200);
	});

	it('rejects a POST with a mismatched Origin (CSRF) with 403', async () => {
		const res = await createTestServer().request('/api/auth/request-code', {
			body: JSON.stringify({ email: 'csrf@example.com' }),
			headers: { ...json, origin: 'https://evil.example' },
			method: 'POST',
		});
		expect(res.status).toBe(403);
	});

	it('allows a POST whose Origin matches APP_ORIGIN', async () => {
		const res = await createTestServer().request('/api/auth/request-code', {
			body: JSON.stringify({ email: 'goodorigin@example.com' }),
			headers: { ...json, origin: env.APP_ORIGIN },
			method: 'POST',
		});
		expect(res.status).toBe(200);
	});
});
