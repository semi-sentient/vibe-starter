import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { client } from '@/web/api/client';

/**
 * The `GET /api/health` payload as the browser sees it. Identical on the `200`
 * (DB up) and `503` (DB unreachable) branches — the Hono RPC response type is the
 * union of the two, so the server must keep both shapes in step.
 */
export interface HealthResponse {
	/** `'up'` when `SELECT 1` succeeded, `'down'` when it did not. Widened to `string` by the RPC type. */
	db: string;
	/** First 7 characters of the deploy's git commit, or `null` when unknown (local dev, plain `docker run`). */
	sha: string | null;
	/** `'ok'` alongside `db: 'up'`, `'degraded'` alongside `db: 'down'`. Widened to `string` by the RPC type. */
	status: string;
	/** The api's `package.json` version, bundled at build time — e.g. `'1.3.2'`. */
	version: string;
}

/**
 * Shared health query. One cache entry (`['health']`) backs every consumer, so
 * mounting several of them costs a single request.
 *
 * A `503` RESOLVES rather than rejecting — it is a real server response, and the
 * `db` field is how callers tell "API up, DB down" from "API unreachable". Only a
 * network failure puts the query in its error state.
 *
 * @example
 * const health = useHealth();
 * const dbConnected = health.isSuccess && health.data.db === 'up';
 */
export function useHealth(): UseQueryResult<HealthResponse> {
	return useQuery<HealthResponse>({
		queryFn: async () => {
			// Resolves on any HTTP response (200 or 503); only a network failure rejects.
			const res = await client.api.health.$get();
			return res.json();
		},
		queryKey: ['health'],
	});
}
