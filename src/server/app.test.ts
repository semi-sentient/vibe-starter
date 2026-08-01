import { describe, expect, it } from 'vitest';
import { env } from '@/env';
import { createTestServer } from '@/server/test/helpers/createTestServer';

describe('GET /api/health', () => {
	it('reports the database is up when it is reachable', async () => {
		const server = createTestServer();

		const res = await server.request('/api/health');

		expect(res.status).toBe(200);
		// `version` is asserted as any string ON PURPOSE: pinning the literal would
		// make a release commit (which bumps package.json) fail `build:validate` on
		// itself. `sha` is the first 7 chars of `.env.test`'s RAILWAY_GIT_COMMIT_SHA.
		await expect(res.json()).resolves.toEqual({
			db: 'up',
			sha: 'abcdef1',
			status: 'ok',
			version: expect.any(String),
		});
	});

	it('reports a null sha when the deploy commit is not known', async () => {
		const server = createTestServer();
		// Mutate the parsed env rather than re-importing the module: `createTestServer`
		// holds a static `app` reference and a re-import would build a second pg.Pool.
		// The handler reads `env.RAILWAY_GIT_COMMIT_SHA` per request, so this is visible.
		const original = env.RAILWAY_GIT_COMMIT_SHA;
		env.RAILWAY_GIT_COMMIT_SHA = undefined;
		try {
			const res = await server.request('/api/health');

			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ sha: null });
		} finally {
			env.RAILWAY_GIT_COMMIT_SHA = original;
		}
	});
});
