import { setupServer } from 'msw/node';

/**
 * The shared MSW (Mock Service Worker) server for component tests.
 *
 * It starts with NO default handlers: every test declares the API responses it
 * needs with `server.use(http.get(...))`, so each test reads as a self-contained
 * spec of the backend behavior it assumes. The request-mocking lifecycle is
 * wired once in `src/web/test/setup.ts` (`listen` on start, `resetHandlers`
 * after each test so per-test handlers don't leak, `close` at the end).
 *
 *   import { http, HttpResponse } from 'msw';
 *   import { server } from '@/web/test/msw-server';
 *
 *   server.use(
 *     http.get('/api/health', () => HttpResponse.json({ db: 'up', status: 'ok' }))
 *   );
 */
export const server = setupServer();
