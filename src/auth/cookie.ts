import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { env } from '@/env';

/** The session cookie name. The opaque `sid` (session id) is its value. */
const SESSION_COOKIE = 'sid';

/** 24 hours, matching the session TTL. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Cookie attributes for the session cookie:
 *   - `HttpOnly` — unreadable from JS (XSS can't exfiltrate the session).
 *   - `SameSite=Lax` — the primary CSRF defense for cookie auth.
 *   - `Secure` only in production — so plain-HTTP localhost dev still works.
 *   - `Path=/`, `Max-Age=86400` — site-wide, 24h.
 * The value itself is SIGNED with `SESSION_SECRET` (see set/read below), so a
 * tampered cookie is rejected.
 */
const cookieOptions: CookieOptions = {
	httpOnly: true,
	maxAge: MAX_AGE_SECONDS,
	path: '/',
	sameSite: 'Lax',
	secure: env.NODE_ENV === 'production',
};

/** Sets the signed session cookie carrying `sid`. */
export async function setSessionCookie(c: Context, sid: string): Promise<void> {
	await setSignedCookie(c, SESSION_COOKIE, sid, env.SESSION_SECRET, cookieOptions);
}

/**
 * Reads and verifies the signed session cookie.
 *
 * Returns the `sid` string when present and the signature verifies, or `null`
 * when the cookie is absent OR tampered (`getSignedCookie` returns `false` for a
 * bad signature — both cases collapse to "no valid session").
 */
export async function readSessionCookie(c: Context): Promise<string | null> {
	const value = await getSignedCookie(c, env.SESSION_SECRET, SESSION_COOKIE);
	return value ? value : null;
}

/** Clears the session cookie (logout). */
export function clearSessionCookie(c: Context): void {
	deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
