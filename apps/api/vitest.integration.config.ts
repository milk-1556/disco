import { defineConfig } from 'vitest/config';

// Integration run — requires a real Postgres + Redis. Defaults match infra/.env.example so it works
// against the local `docker compose up` services (or native brew services).
export default defineConfig({
  test: {
    include: ['**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://disco:disco@localhost:5432/disco?schema=public',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-secret',
      OPERATOR_EMAIL: 'operator@disco.local',
    },
  },
});
