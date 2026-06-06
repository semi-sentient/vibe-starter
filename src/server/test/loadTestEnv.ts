import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env.test` into `process.env`, OVERRIDING any pre-existing values.
 *
 * Why a hand-rolled loader instead of `process.loadEnvFile()` or `dotenv`:
 *   - `process.loadEnvFile()` does NOT overwrite variables already present in
 *     `process.env`. If a developer runs `npm test` from a shell that already
 *     exported `DATABASE_URL` (e.g. they sourced `.env`), that ambient value
 *     would win and the suite could target the DEV database — the one thing the
 *     harness must never touch. Force-overriding makes `.env.test` authoritative.
 *   - It keeps the harness dependency-free (no `dotenv`); the parser only needs
 *     to handle the simple `KEY=value` lines this committed file contains.
 *
 * This is imported (for its side effect) at the very top of `vitest.config.ts`
 * — so the value is present in the main process before `globalSetup` imports
 * `src/env.ts` — and again from `src/server/test/setup.ts`, which runs inside
 * each test fork before the fork's test modules import `src/env.ts`.
 */
export function loadTestEnv(): void {
	// `.env.test` lives at the repo root, two directories up from this file
	// (src/server/test/ -> src/server/ -> src/ -> repo root is three up; use the
	// file URL so resolution is independent of process.cwd()).
	const envPath = fileURLToPath(new URL('../../../.env.test', import.meta.url));

	if (!existsSync(envPath)) {
		throw new Error(
			`[test] .env.test not found at ${envPath}. The test harness requires it to ` +
				`supply DATABASE_URL (pointing at vibe_starter_test) and the other server env vars.`
		);
	}

	const contents = readFileSync(envPath, 'utf8');

	for (const rawLine of contents.split('\n')) {
		const line = rawLine.trim();
		// Skip blanks and comments.
		if (line === '' || line.startsWith('#')) continue;

		const eq = line.indexOf('=');
		if (eq === -1) continue;

		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();

		// Strip a single layer of matching surrounding quotes, if present.
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}

		// Override unconditionally — `.env.test` is the source of truth for tests.
		process.env[key] = value;
	}
}
