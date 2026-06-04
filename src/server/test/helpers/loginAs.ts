import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { authCodes } from '@/db/schema';
import type { TestServer } from '@/server/test/helpers/createTestServer';

const json = { 'content-type': 'application/json' };

/**
 * Logs the given `email` in through the REAL magic-link flow on a {@link
 * TestServer}, leaving the signed `sid` cookie in the server's cookie jar so
 * subsequent `server.request(...)` calls are authenticated.
 *
 * Drives `POST /api/auth/request-code` then `POST /api/auth/verify`, reading the
 * issued (random) code straight from `auth_codes`. The user row is upserted by
 * `verifyCode` with the role resolved from `ADMIN_EMAILS`/invites — so to log in
 * as an admin, either add the email to `ADMIN_EMAILS` or seed an invite first.
 *
 * Note: this exercises the rate limiter (one request+verify pair = 2 hits,
 * comfortably under the 5/10min limit), so a handful of `loginAs` calls per test
 * is safe; `resetDb` clears the counters between tests.
 */
export async function loginAs(server: TestServer, email: string): Promise<void> {
	await server.request('/api/auth/request-code', {
		body: JSON.stringify({ email }),
		headers: json,
		method: 'POST',
	});
	const [row] = await db.select().from(authCodes).where(eq(authCodes.email, email.toLowerCase()));
	if (!row) throw new Error(`[test] loginAs: no auth_code row for ${email}`);
	await server.request('/api/auth/verify', {
		body: JSON.stringify({ code: row.code, email }),
		headers: json,
		method: 'POST',
	});
}
