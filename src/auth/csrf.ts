import type { MiddlewareHandler } from 'hono';
import { env } from '@/env';

/** HTTP methods that don't mutate state and so skip the Origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface CsrfOptions {
	/**
	 * Path prefixes exempt from the Origin check. The escape hatch for routes that
	 * are NOT cookie-authenticated browser requests — notably the Stripe webhook
	 * (P7: `/api/stripe/webhook`), which is server-to-server and authenticated by
	 * signature, not by cookie/Origin. A request whose path starts with any prefix
	 * here bypasses the check entirely.
	 */
	exemptPaths?: string[];
}

/**
 * CSRF defense via an Origin-header check (defense-in-depth on top of the
 * `SameSite=Lax`, signed, HttpOnly session cookie — the primary defense).
 *
 * Safe methods (GET/HEAD/OPTIONS) always pass. For a mutating request the rule is
 * deliberately narrow: reject (`403`) ONLY when an `Origin` header is PRESENT and
 * does NOT match `env.APP_ORIGIN`. A MISSING `Origin` is ALLOWED — browsers
 * always send `Origin` on a cross-origin non-GET, so a forged cross-site request
 * is caught, while same-origin/API/test clients that omit it still work (this is
 * also what keeps the auth POST tests, which send no `Origin`, green).
 *
 * Exemptions: a request whose path matches any `exemptPaths` prefix bypasses the
 * check (P7 adds the Stripe webhook here).
 */
export function csrf(options: CsrfOptions = {}): MiddlewareHandler {
	const exemptPaths = options.exemptPaths ?? [];

	return async (c, next) => {
		if (SAFE_METHODS.has(c.req.method)) return next();

		if (exemptPaths.some((prefix) => c.req.path.startsWith(prefix))) return next();

		const origin = c.req.header('origin');
		// A present, mismatched Origin is the only rejected case; a missing Origin
		// is allowed (SameSite=Lax + the signed cookie carry the defense).
		if (origin && origin !== env.APP_ORIGIN) {
			return c.json({ error: 'Forbidden' }, 403);
		}

		await next();
	};
}
