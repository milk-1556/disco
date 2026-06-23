import { startBuildWorker } from './worker.js';

const worker = startBuildWorker();
// eslint-disable-next-line no-console
console.log(`[disco-worker] listening on queue "disco:builds" (concurrency ${worker.opts.concurrency})`);

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
