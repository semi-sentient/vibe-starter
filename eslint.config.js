import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config (ESM). Authored as a single `tseslint.config(...)` call so
 * the type-aware presets compose cleanly with the per-area override blocks below.
 *
 * Typecheck is per-side (no project references): `projectService: true` lets
 * typescript-eslint pick the right tsconfig (`src/server/tsconfig.json` /
 * `src/web/tsconfig.json`) for each file automatically, so the type-aware rules
 * see the same program the `typecheck` script does.
 *
 * Tailwind arbitrary values: `eslint-plugin-tailwindcss` (3.x) still expects a
 * `tailwind.config.js`, which Tailwind v4 does not use (tokens live in
 * `src/web/globals.css` via `@theme`); the plugin emits a "Cannot resolve default
 * tailwindcss config path" warning on every run. Rather than fight that, we use
 * the regex fallback the plan allows — a `no-restricted-syntax` rule that flags
 * any string literal containing a bracketed arbitrary value (`bg-[#f00]`,
 * `ring-[3px]`, `[&_svg]:...`) — scoped to `src/web/**` and exempted for the
 * vendored `ui/**` directory.
 */

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * A Tailwind "arbitrary value": a class token with bracketed content and no
 * internal whitespace, e.g. `bg-[#f00]`, `ring-[3px]`, `grid-cols-[1fr_2fr]`,
 * `[&_svg]:size-4`. The no-whitespace constraint keeps prose like `[note here]`
 * from matching (Tailwind tokens use underscores, not spaces).
 */
const TAILWIND_ARBITRARY_VALUE_SELECTOR = 'Literal[value=/\\[[^\\]\\s]+\\]/]';

export default tseslint.config(
	// Build artifacts, vendored lockfiles, generated agent files, and the SQL
	// migrations are not ours to lint.
	{
		ignores: [
			'.agents/**',
			'.claude/**',
			'coverage/**',
			'dist/**',
			'dist-server/**',
			'node_modules/**',
			'src/db/migrations/**',
			'temp/**',
			'**/*.min.css',
			'**/*.min.js',
		],
	},

	// Base recommended rules for every file ESLint sees.
	js.configs.recommended,

	// Type-aware linting for the application/source TypeScript. `projectService`
	// resolves each file to its owning tsconfig (server vs web).
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: rootDir,
			},
		},
	},

	// Project-wide rules (all `error` or `off`, per the plan).
	{
		plugins: {
			import: importPlugin,
		},
		rules: {
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{ 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
			],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-explicit-any': 'error',
			'import/order': [
				'error',
				{
					alphabetize: { caseInsensitive: true, order: 'asc' },
					groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
					'newlines-between': 'never',
				},
			],
			'no-console': ['error', { allow: ['error', 'warn'] }],
		},
	},

	// Frontend-only rules: React hooks + JSX key + the Tailwind arbitrary-value guard.
	{
		files: ['src/web/**/*.{ts,tsx}'],
		plugins: {
			react: reactPlugin,
			'react-hooks': reactHooks,
		},
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					message:
						'Arbitrary Tailwind value (e.g. `bg-[#f00]`) is not allowed outside the vendored `ui/` components. Use a theme token from `globals.css`.',
					selector: TAILWIND_ARBITRARY_VALUE_SELECTOR,
				},
			],
			'react-hooks/exhaustive-deps': 'error',
			'react/jsx-key': 'error',
		},
	},

	// Vendored shadcn components are third-party: they legitimately use arbitrary
	// Tailwind values (`ring-[3px]`, `[&_svg]:...`, `has-[>svg]:px-3`). We do not
	// rewrite them, so exempt the directory from the arbitrary-value guard.
	{
		files: ['src/web/components/ui/**/*.{ts,tsx}'],
		rules: {
			'no-restricted-syntax': 'off',
		},
	},

	// Test files lean on test doubles (Vitest's `vi.fn`/`vi.spyOn`, `.mock.calls`,
	// `expect.any`/`expect.objectContaining`, `Proxy`) whose return types are
	// inherently `any`. The `no-unsafe-*`/`unbound-method` rules then fire on
	// otherwise-correct assertions. Relax exactly those rules here. `no-explicit-any`
	// stays ON — an explicit `any` is still an error, even in tests.
	{
		files: ['**/*.test.{ts,tsx}', 'src/**/test/**/*.{ts,tsx}'],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/unbound-method': 'off',
		},
	},

	// Config files (`*.config.{js,ts}`, e.g. this file, vite/vitest/drizzle) live
	// outside the TS projects, so the type-aware program can't include them.
	// Drop type-checked rules there to avoid "file not in project" parser errors,
	// and declare Node globals (without the TS program, `no-undef` can't see them).
	{
		files: ['**/*.config.{js,ts}'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			globals: globals.node,
		},
	},

	// Repo-tooling scripts (`scripts/**/*.mjs`, e.g. the downstream release-state
	// reset) are dependency-free Node ESM outside the TS projects, like the config
	// files above. Same treatment: drop type-checked rules and declare Node globals.
	{
		files: ['scripts/**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			globals: globals.node,
		},
	},

	// Must be last: turns off every formatting rule that would conflict with
	// Prettier (Prettier owns formatting; ESLint owns correctness).
	prettier
);
