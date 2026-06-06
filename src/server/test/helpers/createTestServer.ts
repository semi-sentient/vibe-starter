import { app } from '@/server/app';

/**
 * An in-process test client for the Hono `app`, with an automatic cookie jar.
 *
 * `request()` wraps Hono's `app.request()` — no network, no port, no mocking.
 * It exercises the real router, middleware, and Drizzle queries against the test
 * database, just in-process and fast.
 *
 * The cookie jar makes multi-request session flows ergonomic: any `Set-Cookie`
 * a response returns is remembered and automatically sent back as a `Cookie`
 * header on the next request from the SAME server instance. So an auth flow can
 * be driven as a sequence of calls without manually threading cookies (see the
 * usage example on {@link createTestServer}). Each `createTestServer()` call gets
 * an isolated jar, so independent sessions don't bleed into one another.
 */
export interface TestServer {
	/** Drop all remembered cookies (e.g. to simulate a fresh, logged-out client). */
	clearCookies(): void;
	/** A snapshot of the current jar as a `name=value; name=value` Cookie string (empty if none). */
	cookieHeader(): string;
	/**
	 * Issue an in-process request. Remembered cookies are attached automatically
	 * unless the caller supplies its own `Cookie` header (which takes precedence).
	 * Any `Set-Cookie` on the response is folded back into the jar.
	 */
	request(path: string, init?: RequestInit): Promise<Response>;
}

export function createTestServer(): TestServer {
	// name -> value. Intentionally minimal: we only track the cookie name/value
	// pair needed to echo a `Cookie` header back; attributes (Path, HttpOnly,
	// Max-Age, …) are irrelevant to in-process round-trips and a `Max-Age=0`
	// expiry is handled below by deleting the entry.
	const jar = new Map<string, string>();

	function cookieHeader(): string {
		return Array.from(jar, ([name, value]) => `${name}=${value}`).join('; ');
	}

	function rememberFromResponse(res: Response): void {
		// `getSetCookie()` returns each Set-Cookie header line separately (the
		// correct way to read multiple cookies; a plain `.get('set-cookie')` folds
		// them into one comma-joined string that can't be split safely).
		for (const setCookie of res.headers.getSetCookie()) {
			const firstPair = setCookie.split(';', 1)[0] ?? '';
			const eq = firstPair.indexOf('=');
			if (eq === -1) continue;

			const name = firstPair.slice(0, eq).trim();
			const value = firstPair.slice(eq + 1).trim();
			if (name === '') continue;

			// An expiry (Max-Age=0 / Expires in the past) signals a deletion. Treat
			// an empty value as a clear so a sign-out that blanks the cookie removes
			// it from the jar rather than echoing an empty one.
			if (value === '' || /(^|;)\s*max-age=0\b/i.test(setCookie)) {
				jar.delete(name);
			} else {
				jar.set(name, value);
			}
		}
	}

	async function request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		// Attach remembered cookies unless the caller set their own Cookie header.
		if (!headers.has('cookie') && jar.size > 0) {
			headers.set('cookie', cookieHeader());
		}

		const res = await app.request(path, { ...init, headers });
		rememberFromResponse(res);
		return res;
	}

	return {
		clearCookies: () => jar.clear(),
		cookieHeader,
		request,
	};
}
