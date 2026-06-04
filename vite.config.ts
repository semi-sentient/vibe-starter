import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// Resolve paths relative to this config file (the repo root), independent of `root`.
const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const webDir = fileURLToPath(new URL('./src/web', import.meta.url));

export default defineConfig({
	build: {
		// Emit the web build to the repo-root `dist/`, not `src/web/dist/`.
		emptyOutDir: true,
		outDir: fileURLToPath(new URL('./dist', import.meta.url)),
	},
	plugins: [react()],
	resolve: {
		// Mirror the `@/*` -> `./src/*` tsconfig path so shadcn-generated `@/lib/utils`
		// imports (added in a later phase) resolve in the bundle too.
		alias: {
			'@': srcDir,
		},
	},
	// The web app's index.html and entry live under src/web.
	root: webDir,
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
