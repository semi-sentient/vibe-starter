import { defineConfig } from 'drizzle-kit';
import { env } from '@/env';

/**
 * Drizzle Kit configuration — drives `db:generate`, `db:migrate`, and `db:studio`.
 *
 * `drizzle-kit` is a devDependency and auto-loads `.env` from the project root
 * before importing this file, so `env.DATABASE_URL` is populated here. The
 * programmatic production migrator (`src/db/migrate.ts`) does NOT depend on
 * drizzle-kit — it ships only the generated `.sql` files plus `drizzle-orm`.
 */
export default defineConfig({
	dbCredentials: {
		url: env.DATABASE_URL,
	},
	dialect: 'postgresql',
	out: './src/db/migrations',
	schema: './src/db/schema.ts',
});
