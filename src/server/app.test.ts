import { describe, expect, it } from 'vitest';
import { createTestServer } from '@/server/test/helpers/createTestServer';

describe('GET /api/health', () => {
	it('reports the database is up when it is reachable', async () => {
		const server = createTestServer();

		const res = await server.request('/api/health');

		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ db: 'up', status: 'ok' });
	});
});
