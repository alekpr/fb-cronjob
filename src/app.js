import express from 'express';
import pagesRoutes from './routes/pages.js';
import jobRoutes from './routes/jobs.js';
import logRoutes from './routes/logs.js';
import { PUBLIC_DIR } from './paths.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', pagesRoutes);
  app.use('/api', jobRoutes);
  app.use('/api', logRoutes);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use(express.static(PUBLIC_DIR));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload ใหญ่เกินไป' });
    }
    res.status(500).json({ error: err?.message || 'internal error' });
  });

  return app;
}
