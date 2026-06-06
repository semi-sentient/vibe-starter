import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from '@/db/client';

/**
 * Production migrator. Replays the checked-in SQL migrations in
 * `src/db/migrations/` against the database behind `db` (i.e. `DATABASE_URL`).
 *
 * This is the production counterpart to dev's `drizzle-kit migrate` (the
 * `predev` hook) — it runs the SAME migration set without requiring the
 * `drizzle-kit` devDependency at runtime. Phase 12's Dockerfile COPYs the
 * `.sql` files and runs the bundled `dist-server/migrate.js` before booting
 * the server.
 */
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'src/db/migrations' });
}

// Runnable entry: when executed directly (`node dist-server/migrate.js` or
// `tsx src/db/migrate.ts`), apply the migrations, log, and exit. The pool keeps
// the event loop alive, so exit explicitly once done.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	runMigrations()
		.then(() => {
			// eslint-disable-next-line no-console -- structured logging arrives in a later phase.
			console.log('[migrate] migrations applied');
			process.exit(0);
		})
		.catch((err: unknown) => {
			console.error('[migrate] migration failed', err);
			process.exit(1);
		});
}
