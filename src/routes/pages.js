import { Router } from 'express';
import {
  createPage,
  deletePage,
  findPage,
  listPages,
  setDefaultPage,
  upsertPage,
} from '../db/db.js';
import * as fb from '../services/fbService.js';

const router = Router();

/** ตัด access_token ออกก่อนส่งกลับ client */
function publicPage(p) {
  if (!p) return null;
  return { id: p.id, name: p.name, is_default: p.is_default, created_at: p.created_at };
}

router.get('/pages', (_req, res) => {
  res.json({ pages: listPages() });
});

router.post('/pages', (req, res) => {
  const { id, name, accessToken, isDefault } = req.body || {};
  if (!id || !accessToken) {
    return res.status(400).json({ error: 'กรุณากรอก Page ID และ Access Token' });
  }
  const page = createPage({
    id: String(id).trim(),
    name: String(name || id).trim(),
    accessToken: String(accessToken).trim(),
    isDefault: Boolean(isDefault),
  });
  res.status(201).json(publicPage(page));
});

router.post('/pages/import', async (req, res) => {
  const { userToken } = req.body || {};
  if (!userToken) return res.status(400).json({ error: 'กรุณาวาง User Access Token' });
  try {
    const pages = await fb.fetchPages(userToken);
    if (!pages.length) return res.status(400).json({ error: 'ไม่พบเพจที่ token นี้เข้าถึง' });
    for (const p of pages) upsertPage(p);
    res.json({ pages: listPages(), imported: pages.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pages/:id/default', (req, res) => {
  const page = setDefaultPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'ไม่พบเพจนี้' });
  res.json(publicPage(page));
});

router.delete('/pages/:id', (req, res) => {
  deletePage(req.params.id);
  res.json({ ok: true });
});

router.post('/pages/:id/test', async (req, res) => {
  const page = findPage(req.params.id);
  if (!page) return res.status(404).json({ error: 'ไม่พบเพจนี้' });
  try {
    res.json(await fb.testPage(page.id, page.access_token));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/config', (_req, res) => {
  const pages = listPages();
  res.json({
    dryRun: fb.isDryRun(),
    timezone: process.env.TIMEZONE || 'Asia/Bangkok',
    pageCount: pages.length,
    hasDefault: pages.some((p) => p.is_default),
  });
});

export default router;
