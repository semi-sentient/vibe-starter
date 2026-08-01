import { useHealth } from '@/web/api/useHealth';

/**
 * "What's live" stamp — the running version and, when the deploy is known, its
 * short commit SHA (`v1.3.2 (abcdef1)`). Values come from `GET /api/health`
 * through the shared {@link useHealth} query, so mounting it in several places
 * costs no extra requests.
 *
 * Renders NOTHING while the query is pending or errored: a half-known build
 * identity ("v" on its own, or `vundefined`) is worse than no stamp at all.
 */
export function VersionStamp() {
	const health = useHealth();

	if (health.isPending || !health.data) return null;

	const { sha, version } = health.data;

	return (
		<p className="text-muted-foreground text-center text-xs">
			{sha ? `v${version} (${sha})` : `v${version}`}
		</p>
	);
}
