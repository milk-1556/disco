import { configDefaults, defineConfig } from 'vitest/config';

// Default unit run — excludes the integration test (which needs Postgres + Redis).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
  },
});
