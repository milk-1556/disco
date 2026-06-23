import { env, isLiveMode } from './env.js';
import { buildServer } from './server.js';

const app = buildServer();

app
  .listen({ host: env.host, port: env.port })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`[disco-api] listening on http://${env.host}:${env.port} (${isLiveMode() ? 'LIVE' : 'DEMO'} mode)`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[disco-api] failed to start', err);
    process.exit(1);
  });
