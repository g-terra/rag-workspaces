// `pnpm --filter @rag/db db:migrate`: apply migrations to DATABASE_URL by hand.
// The API also runs them on every start, so this is only for development.
import { runMigrations } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set\n');
  process.exit(1);
}
await runMigrations(url);
process.stdout.write('migrations applied\n');
