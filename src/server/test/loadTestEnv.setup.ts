import { loadTestEnv } from './loadTestEnv';

/**
 * Per-fork env loader, listed FIRST in the server project's `setupFiles`.
 *
 * Each test fork is a fresh process. Although it inherits the parent process's
 * `process.env` (where vitest.config.ts already loaded `.env.test`), this file
 * is the belt-and-suspenders guarantee the spec calls for: it (re)loads
 * `.env.test` with override BEFORE the second setup file — or any test module —
 * imports `src/env.ts`. Because this module imports nothing app-related, its
 * (hoisted) imports cannot trigger an early `src/env.ts` evaluation against
 * missing vars. Keeping it as a separate file from the `resetDb` registration
 * preserves that ordering guarantee.
 */
loadTestEnv();
