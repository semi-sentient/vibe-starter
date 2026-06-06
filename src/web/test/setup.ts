import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw-server';

/**
 * Web project per-fork setup (happy-dom environment).
 *
 * Two responsibilities:
 *   1. jest-dom matchers — the bare `@testing-library/jest-dom/vitest` import
 *      above registers `toBeInTheDocument`, `toHaveTextContent`, etc. on Vitest's
 *      `expect`.
 *   2. MSW request-mocking lifecycle — start the shared server before the suite,
 *      reset per-test handlers after each test (so `server.use(...)` calls don't
 *      leak between tests), and close it at the end.
 *
 * `cleanup()` unmounts React trees between tests (RTL's auto-cleanup only fires
 * when Vitest globals are enabled; we import APIs explicitly, so we wire it here).
 *
 * `onUnhandledRequest: 'error'` makes any request without a matching handler fail
 * the test loudly, so a forgotten mock surfaces immediately instead of hanging.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
	cleanup();
	server.resetHandlers();
});

afterAll(() => server.close());
