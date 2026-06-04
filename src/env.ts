import { z } from 'zod';

/**
 * Server-side environment schema, parsed once at boot.
 *
 * This grows phase by phase. Every new variable added here MUST also be added
 * to `.env.example` in the same change (see AGENTS.md). Secrets live here only,
 * never in `VITE_*` (those ship to the browser bundle).
 */
const schema = z.object({
	// Comma-separated allowlist of emails granted the `admin` role at login.
	// Normalized to a lowercased `string[]`; empty when unset.
	ADMIN_EMAILS: z
		.string()
		.default('')
		.transform((s) =>
			s
				.split(',')
				.map((e) => e.trim().toLowerCase())
				.filter(Boolean)
		),
	// Public origin of the app — used to build magic-link / redirect URLs and
	// (from P5) to validate the request Origin header for CSRF defense.
	APP_ORIGIN: z.string().url(),
	DATABASE_URL: z.string().url(),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	// Resend API key for sending magic-link emails. Optional: when unset, the code
	// is logged to the server console instead (dev fallback).
	RESEND_API_KEY: z.string().optional(),
	// Secret used to sign the `sid` session cookie. Min 32 chars.
	SESSION_SECRET: z.string().min(32),
	// Stripe SECRET API key (P7) — creates Checkout Sessions and calls the Stripe
	// API. Server-only; NEVER expose it (no `VITE_` prefix). Use a test-mode
	// `sk_test_...` key in dev.
	STRIPE_SECRET_KEY: z.string(),
	// Stripe webhook signing secret (P7) — verifies `POST /api/stripe/webhook`
	// signatures against the RAW request body. Server-only. In dev the Stripe CLI
	// (`stripe listen`) prints a `whsec_...` value to use here.
	STRIPE_WEBHOOK_SECRET: z.string(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	const issues = parsed.error.issues
		.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('\n');
	throw new Error(`Invalid server environment:\n${issues}`);
}

export const env = parsed.data;
