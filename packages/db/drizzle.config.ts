import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @rag/db db:generate` compares src/schema.ts with the last migration
// and writes the next SQL file into drizzle/. Commit the generated files.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
