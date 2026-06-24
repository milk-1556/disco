import { assertSecureEnv, env, isLiveMode, usePrisma, useQueue } from './env.js';
import { makeRepo, seedIfEmpty } from './runtime.js';
import { buildServer } from './server.js';

assertSecureEnv(); // refuse to boot a production-shaped deploy on the public dev secret
const repo = makeRepo();
const app = buildServer({ repo });

async function main() {
  // Seed the sample template so the dashboard is useful on first boot (no-op if anything exists).
  await seedIfEmpty(repo);
  await app.listen({ host: env.host, port: env.port });
  const persistence = usePrisma() ? 'postgres' : 'in-memory';
  const queue = useQueue() ? 'redis-queue' : 'in-process';
  // eslint-disable-next-line no-console
  console.log(
    `[disco-api] http://${env.host}:${env.port} · ${isLiveMode() ? 'LIVE' : 'DEMO'} · ${persistence} · ${queue}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[disco-api] failed to start', err);
  process.exit(1);
});
