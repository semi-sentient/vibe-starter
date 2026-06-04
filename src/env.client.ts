import { z } from 'zod';

/**
 * Client-side environment schema, validated at bundle time from `import.meta.env`.
 *
 * Only `VITE_*` variables are exposed to the browser bundle by Vite. NEVER put a
 * secret here — anything in this schema ships to the client. This grows phase by
 * phase; every addition MUST also be added to `.env.example` in the same change.
 */
const schema = z.object({
	// Base URL for the Hono RPC client. The app mounts routes under `.basePath('/api')`,
	// so the typed paths already include `/api` — the client base is the ORIGIN, not `/api`.
	// In dev, `/` lets Vite's proxy forward `/api/*` to the Hono server.
	VITE_API_URL: z.string().default('/'),
	// Stripe PUBLISHABLE key (P7) — safe to expose in the browser bundle (unlike
	// the secret/webhook keys, which are server-only). The shipped flow is HOSTED
	// Checkout (a redirect to Stripe's page), which needs NO client-side Stripe
	// config, so this is OPTIONAL — it is validated here for builders who later
	// add Stripe.js / Elements (an embedded card form), which DO need it.
	VITE_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

const parsed = schema.safeParse(import.meta.env);

if (!parsed.success) {
	const issues = parsed.error.issues
		.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('\n');
	throw new Error(`Invalid client environment:\n${issues}`);
}

export const clientEnv = parsed.data;
