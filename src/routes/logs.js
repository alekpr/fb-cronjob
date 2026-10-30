import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { LOG_FILE } from '../utils/logger.js';

const router = Router();

router.get('/logs', async (req, res) => {
  try {
    const requested = Number(req.query.lines) || 200;
    const lines = Math.min(requested, 2000);
    const data = await readFile(LOG_FILE, 'utf8');
    const all = data.split('\n').filter(Boolean);
    res.json({ lines: all.slice(-lines) });
  } catch {
    res.json({ lines: [] });
  }
});

export default router;
