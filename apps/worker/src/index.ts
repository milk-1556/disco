import { startBuildWorker } from './worker.js';

// REDIS_URL implies DATABASE_URL: without a shared Postgres, the worker would write results to its
// own throwaway store and the API would never see the job complete (stuck 'queued'). Refuse to boot.
if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('[disco-worker] DATABASE_URL is required (the worker shares Postgres with the API). Refusing to start.');
  process.exit(1);
}
if (!process.env.REDIS_URL) {
  // eslint-disable-next-line no-console
  console.error('[disco-worker] REDIS_URL is required (the worker consumes the BullMQ queue). Refusing to start.');
  process.exit(1);
}

const worker = startBuildWorker();
// eslint-disable-next-line no-console
console.log(`[disco-worker] listening on queue "disco:builds" (concurrency ${worker.opts.concurrency})`);

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
