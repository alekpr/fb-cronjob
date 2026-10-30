import 'dotenv/config';
import { createApp } from './app.js';
import { ensureDirs } from './paths.js';
import { startScheduler } from './services/scheduler.js';
import logger from './utils/logger.js';

ensureDirs();

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const dryRun = process.env.DRY_RUN !== 'false';

const app = createApp();
const server = app.listen(port, host, () => {
  logger.info(`fb-cronjob ready at http://${host}:${port} (dry-run: ${dryRun})`);
});
server.on('error', (err) => {
  logger.error({ error: err.message }, `failed to listen on ${host}:${port}`);
  process.exit(1);
});

startScheduler();
