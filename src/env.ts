import { z } from 'zod';

/**
 * Server-side environment schema, parsed once at boot.
 *
 * This grows phase by phase. Every new variable added here MUST also be added
 * to `.env.example` in the same change (see AGENTS.md). Secrets live here only,
 * never in `VITE_*` (those ship to the browser bundle).
 */
const schema = z.object({
	DATABASE_URL: z.string().url(),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	const issues = parsed.error.issues
		.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('\n');
	throw new Error(`Invalid server environment:\n${issues}`);
}

export const env = parsed.data;
