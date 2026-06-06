/**
 * lint-staged config (ESM — the package is `"type": "module"`).
 *
 * Authored as JS (not `.lintstagedrc`) because two entries use the function form:
 *
 *   - The `*.{ts,tsx}` typecheck step returns a fixed command that deliberately
 *     IGNORES the staged file list. Typecheck runs per-side against each
 *     tsconfig (`src/server` / `src/web`) so each side's strictness flags are
 *     honored; feeding `tsc` an explicit file list would bypass the project's
 *     `include`/compiler options. `eslint --fix` then auto-fixes and re-stages,
 *     and `vitest related` is given the staged files so only affected tests run.
 *
 *   - The global secret scan is delegated to `scripts/gitleaks-protect.sh`,
 *     which warns-and-skips when the gitleaks binary is absent and otherwise
 *     runs `gitleaks protect --staged` (propagating a finding as a failure).
 *
 * lint-staged runs each command via `tinyexec` with NO shell — every command
 * string is split on whitespace and the first token is exec'd directly. So a
 * raw `tsc … && tsc …` would pass `&&` to `tsc` as a literal arg and fail.
 * We therefore return `npm run typecheck` (npm runs its script through a shell,
 * where the `&&` is honored); that script IS the project-scoped two-tsconfig
 * command, keeping a single source of truth. For the same reason the compound
 * gitleaks guard lives in an executable script invoked as a single token.
 *
 * Any non-zero exit from any command rejects the commit.
 */
export default {
	'*': 'scripts/gitleaks-protect.sh',
	'*.{json,md,css,yml}': 'prettier --ignore-unknown --write',
	'*.{ts,tsx}': [
		() => 'npm run typecheck',
		'eslint --fix',
		(files) => `vitest related --run ${files.join(' ')}`,
	],
};
