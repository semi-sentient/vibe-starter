import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { loadTestEnv } from './src/server/test/loadTestEnv';

// Load `.env.test` into THIS (the main) process BEFORE anything below imports
// `src/env.ts`. `globalSetup` (DB create + migrate) runs in this process and
// pulls in `src/db/client.ts` -> `src/env.ts`, whose boot-time `safeParse` would
// abort the whole suite if DATABASE_URL were missing. Each test fork additionally
// reloads `.env.test` via the server setup file (see `setupFiles` below), because
// forks are fresh processes that re-import `src/env.ts`.
loadTestEnv();

// `@/*` -> `./src/*`, mirroring the tsconfig path and vite.config.ts so test
// modules resolve `@/db/client`, `@/web/api/client`, etc. exactly as dev/prod do.
const srcAlias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
	// Root-level alias so the root `globalSetup` (which runs OUTSIDE any project)
	// can resolve `@/db/migrate`. Each project re-declares it for its own modules.
	resolve: { alias: srcAlias },
	test: {
		// One shared test database (`vibe_starter_test`) is created + migrated once
		// here, before any project runs. Programmatic migrator only — NEVER
		// drizzle-kit, which would auto-load `.env` and migrate the DEV db.
		globalSetup: ['./src/server/test/globalSetup.ts'],

		// Serial execution. The spec calls for `pool: 'forks', singleFork: true`,
		// but Vitest 4 removed `poolOptions`/`singleFork` (the "pool rework"); the
		// top-level replacement for a single, non-parallel fork is
		// `fileParallelism: false` (which also pins `maxWorkers` to 1). Net effect
		// is identical to the old `singleFork: true`: every test file runs in ONE
		// forked process, one after another — so the DB tests sharing the single
		// test database never run concurrently against it.
		fileParallelism: false,
		maxWorkers: 1,
		pool: 'forks',

		projects: [
			{
				resolve: { alias: srcAlias },
				test: {
					environment: 'node',
					// `src/server/**` plus the server-side auth (`src/auth/**`) and payments
					// (`src/payments/**`) domains, which run in the Node environment and use the
					// same DB-backed harness.
					include: [
						'src/auth/**/*.test.ts',
						'src/payments/**/*.test.ts',
						'src/server/**/*.test.ts',
					],
					name: 'server',
					// Ordered: first (re)load `.env.test` into the fork (before any
					// `src/env.ts` import), then register the `resetDb` beforeEach.
					setupFiles: [
						'./src/server/test/loadTestEnv.setup.ts',
						'./src/server/test/setup.ts',
					],
				},
			},
			{
				plugins: [react()],
				resolve: { alias: srcAlias },
				test: {
					environment: 'happy-dom',
					include: ['src/web/**/*.test.{ts,tsx}'],
					name: 'web',
					// jest-dom matchers + MSW lifecycle (listen / resetHandlers / close).
					setupFiles: ['./src/web/test/setup.ts'],
				},
			},
			{
				// Repo-tooling scripts (e.g. the downstream release-state reset) are
				// dependency-free Node ESM with no `@/*` alias and no DB; they get a
				// plain Node project — no `resolve`, `setupFiles`, or `plugins`. The
				// root `globalSetup` still runs (and starts the test DB) for every
				// project, this one just doesn't use it.
				test: {
					environment: 'node',
					include: ['scripts/**/*.test.mjs'],
					name: 'scripts',
				},
			},
		],
	},
});
