import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { setSessionCookie } from '@/auth/cookie';
import { requireAuth, requireRole } from '@/auth/middleware';
import { createSession, destroySession } from '@/auth/sessions';
import type { AppContext } from '@/server/app';
import { createUser } from '@/server/test/factories/users';

/**
 * A throwaway app exercising the auth middleware in isolation:
 *   - `/__sign?sid=…` signs a session cookie (stand-in for the verify route).
 *   - `/__protected` is gated by `requireAuth` and echoes the resolved user.
 *   - `/__admin` is gated by `requireRole('admin')` and echoes the user's role.
 * The TestServer cookie jar carries the signed cookie between the two calls.
 */
function harness() {
	const testApp = new Hono<AppContext>();
	testApp.get('/__sign', async (c) => {
		await setSessionCookie(c, c.req.query('sid') ?? '');
		return c.body(null, 204);
	});
	testApp.get('/__protected', requireAuth(), (c) => c.json({ userId: c.var.user.id }));
	testApp.get('/__admin', requireRole('admin'), (c) => c.json({ role: c.var.user.role }));
	return testApp;
}

/** Signs a session for `user` and returns the `Cookie` header carrying it. */
async function signedCookieFor(app: ReturnType<typeof harness>, userId: number): Promise<string> {
	const signed = await app.request(`/__sign?sid=${await createSession(userId)}`);
	return signed.headers.getSetCookie()[0] ?? '';
}

describe('requireAuth', () => {
	it('rejects with 401 when no session cookie is present', async () => {
		const res = await harness().request('/__protected');
		expect(res.status).toBe(401);
	});

	it('passes (200) and sets c.var.user for a valid signed session cookie', async () => {
		const app = harness();
		const user = await createUser();
		const sid = await createSession(user.id);

		// Sign the cookie, then carry it to the protected route.
		const signed = await app.request(`/__sign?sid=${sid}`);
		const cookie = signed.headers.getSetCookie()[0] ?? '';
		const res = await app.request('/__protected', { headers: { cookie } });

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ userId: user.id });
	});

	it('rejects with 401 when the session has been destroyed', async () => {
		const app = harness();
		const user = await createUser();
		const sid = await createSession(user.id);
		const signed = await app.request(`/__sign?sid=${sid}`);
		const cookie = signed.headers.getSetCookie()[0] ?? '';

		await destroySession(sid);

		const res = await app.request('/__protected', { headers: { cookie } });
		expect(res.status).toBe(401);
	});

	it('rejects a tampered cookie (bad signature) with 401', async () => {
		const app = harness();
		const user = await createUser();
		const sid = await createSession(user.id);
		const signed = await app.request(`/__sign?sid=${sid}`);
		const cookie = signed.headers.getSetCookie()[0] ?? '';

		// Flip the cookie VALUE while keeping its name — the HMAC no longer matches.
		const tampered = cookie.replace(/sid=[^;]*/, 'sid=tampered-value');
		const res = await app.request('/__protected', { headers: { cookie: tampered } });
		expect(res.status).toBe(401);
	});
});

describe('requireRole', () => {
	it('rejects with 401 when unauthenticated (composes requireAuth first)', async () => {
		const res = await harness().request('/__admin');
		expect(res.status).toBe(401);
	});

	it('rejects an authenticated user lacking the role with 403', async () => {
		const app = harness();
		const user = await createUser({ role: 'user' });
		const cookie = await signedCookieFor(app, user.id);

		const res = await app.request('/__admin', { headers: { cookie } });
		expect(res.status).toBe(403);
	});

	it('passes (200) when the authenticated user has the required role', async () => {
		const app = harness();
		const admin = await createUser({ role: 'admin' });
		const cookie = await signedCookieFor(app, admin.id);

		const res = await app.request('/__admin', { headers: { cookie } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ role: 'admin' });
	});
});
