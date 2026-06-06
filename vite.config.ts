import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve paths relative to this config file (the repo root), independent of `root`.
const srcDir = fileURLToPath(new URL('./src', import.meta.url));

// NOTE: Vite's `root` is intentionally left as the default (the repo root, where
// `index.html` lives) rather than `src/web`. With `root: src/web`, the frontend
// directory `src/web/api/` is served at the URL `/api/`, which collides with the
// `server.proxy['/api']` rule below: requests for the frontend modules
// `/api/query.ts` and `/api/client.ts` get proxied to Hono (no such route -> 404),
// breaking the module graph so React never mounts. Keeping the repo root as `root`
// serves source modules under `/src/web/...` (and `/src/...` via the `@` alias),
// none under `/api/`. Do NOT set `root: src/web` — it reintroduces this collision.
export default defineConfig({
	build: {
		// Emit the web build to the repo-root `dist/`, not `src/web/dist/`.
		emptyOutDir: true,
		outDir: fileURLToPath(new URL('./dist', import.meta.url)),
	},
	plugins: [react(), tailwindcss()],
	resolve: {
		// Mirror the `@/*` -> `./src/*` tsconfig path so shadcn-generated `@/lib/utils`
		// imports (added in a later phase) resolve in the bundle too.
		alias: {
			'@': srcDir,
		},
	},
	server: {
		port: 5173,
		proxy: {
			// Forward API calls to the Hono dev server. No rewrite: the path already
			// includes `/api` (Hono's basePath), so it maps 1:1 to the backend.
			'/api': {
				changeOrigin: false,
				target: 'http://localhost:3000',
			},
		},
	},
});
