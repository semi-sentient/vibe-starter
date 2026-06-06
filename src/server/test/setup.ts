import { beforeEach } from 'vitest';
import { resetDb } from './helpers/resetDb';

/**
 * Server project per-fork setup, listed SECOND in `setupFiles` (after
 * `loadTestEnv.setup.ts`, which guarantees `.env.test` is loaded before the
 * `resetDb` import below transitively evaluates `src/env.ts`).
 *
 * Registers `resetDb` to run before every backend test, so each test starts
 * from an empty database with identity sequences reset — deterministic ids that
 * a later access-control (IDOR) anchor test relies on. Because the suite runs
 * serially in a single fork (see vitest.config.ts), tests never race on the
 * shared test database.
 *
 * Vitest APIs are imported explicitly rather than relying on globals, so the
 * leaf tsconfigs don't need a `vitest/globals` entry in their `types` array.
 */
beforeEach(resetDb);
