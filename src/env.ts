import { z, ZodError } from 'zod';

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
	// Anthropic API key. OPTIONAL and intentionally UNUSED by the shipped code —
	// it ships here so builders adding AI features have the validated slot ready
	// (consume it via `env.ANTHROPIC_API_KEY`). No shipped code path reads it.
	ANTHROPIC_API_KEY: z.string().optional(),
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

/**
 * Parses + validates `process.env`, or aborts the boot.
 *
 * On a `ZodError` we print ONLY the FIRST offending var as a single readable line
 * (`path: message`) and `process.exit(1)` — a one-line boot failure beats a wall
 * of stack trace when a deploy is missing an env var. We deliberately use
 * `console.error` (not the pino logger) because `src/server/logger.ts` imports
 * THIS module, and the logger may not be constructable when the env is invalid.
 */
function loadEnv(): z.infer<typeof schema> {
	try {
		return schema.parse(process.env);
	} catch (err) {
		if (err instanceof ZodError) {
			const [issue] = err.issues;
			const path = issue?.path.join('.') || '(root)';

			console.error(`Invalid server environment — ${path}: ${issue?.message}`);
			process.exit(1);
		}
		throw err;
	}
}

export const env = loadEnv();
