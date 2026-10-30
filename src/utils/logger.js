import pino from 'pino';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../paths.js';

const logDir = path.join(ROOT, 'logs');
mkdirSync(logDir, { recursive: true });

export const LOG_FILE = path.join(logDir, 'app.log');

const level = process.env.LOG_LEVEL || 'info';

const streams = [
  {
    stream: pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:yyyy-mm-dd HH:MM:ss' },
    }),
  },
  { stream: createWriteStream(LOG_FILE, { flags: 'a' }) },
];

const logger = pino(
  { level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime },
  pino.multistream(streams),
);

export default logger;
