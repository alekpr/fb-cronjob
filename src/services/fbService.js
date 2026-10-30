import { open, readFile, stat } from 'node:fs/promises';
import { createRateLimiter } from './rateLimiter.js';
import logger from '../utils/logger.js';

const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // ค่าเริ่มต้น dry-run (ปลอดภัย)

const limiter = createRateLimiter(1);

const RESUME_THRESHOLD = 50 * 1024 * 1024; // 50 MB
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB

export const isDryRun = () => DRY_RUN;

const AUTH_ERROR_CODES = new Set([190, 102, 104]);

function formatGraphError(data) {
  const { code, message, error_subcode } = data?.error || {};
  if (AUTH_ERROR_CODES.has(code)) {
    return `Access token ไม่ถูกต้อง/หมดอายุ (error ${code}${error_subcode ? `/${error_subcode}` : ''}): ${message}`;
  }
  return `Graph API error ${code ?? ''}: ${message}`;
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}

async function graphPost(endpoint, form) {
  const data = await jsonFetch(`${GRAPH}/${endpoint}`, { method: 'POST', body: form });
  if (data?.error) throw new Error(formatGraphError(data));
  return data;
}

async function uploadMedia(pageId, token, endpoint, filePath, filename, label) {
  if (DRY_RUN) {
    const id = `dry_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ filename }, `[dry-run] mock upload ${label}`);
    return { id };
  }
  return limiter(async () => {
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('access_token', token);
    form.append('published', 'false');
    form.append('source', new Blob([buf]), filename);
    const data = await graphPost(`${pageId}/${endpoint}`, form);
    logger.info({ filename, id: data.id }, `uploaded ${label}`);
    return data;
  });
}

export function uploadPhoto(pageId, token, filePath, filename) {
  return uploadMedia(pageId, token, 'photos', filePath, filename, 'photo');
}

export async function uploadVideo(pageId, token, filePath, filename) {
  if (DRY_RUN) {
    const id = `dry_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ filename }, '[dry-run] mock upload video');
    return { id };
  }
  const { size } = await stat(filePath);
  if (size > RESUME_THRESHOLD) return resumableVideoUpload(pageId, token, filePath, filename);
  return uploadMedia(pageId, token, 'videos', filePath, filename, 'video');
}

async function resumableVideoUpload(pageId, token, filePath, filename) {
  const { size } = await stat(filePath);

  const startUrl = `${GRAPH}/${pageId}/videos?upload_phase=start&file_size=${size}&access_token=${encodeURIComponent(token)}`;
  const start = await jsonFetch(startUrl, { method: 'POST' });
  if (start?.error) throw new Error(formatGraphError(start));
  const sessionId = start.upload_session_id;
  const videoId = start.video_id;
  if (!sessionId || !videoId) throw new Error('Resumable upload: ไม่ได้รับ upload_session_id/video_id');

  const fh = await open(filePath, 'r');
  try {
    let offset = 0;
    while (offset < size) {
      const chunk = Buffer.alloc(Math.min(CHUNK_SIZE, size - offset));
      await fh.read(chunk, 0, chunk.length, offset);
      const url = `${GRAPH}/${pageId}/videos?upload_phase=transfer&start_offset=${offset}&upload_session_id=${encodeURIComponent(sessionId)}&access_token=${encodeURIComponent(token)}`;
      const r = await jsonFetch(url, { method: 'POST', body: chunk });
      if (r?.error) throw new Error(formatGraphError(r));
      offset = r.end_offset ?? offset + chunk.length;
    }
    const finishUrl = `${GRAPH}/${pageId}/videos?upload_phase=finish&upload_session_id=${encodeURIComponent(sessionId)}&published=false&access_token=${encodeURIComponent(token)}`;
    const fin = await jsonFetch(finishUrl, { method: 'POST', body: Buffer.alloc(0) });
    if (fin?.error) throw new Error(formatGraphError(fin));
  } finally {
    await fh.close();
  }

  logger.info({ filename, id: videoId }, 'uploaded video (resumable)');
  return { id: videoId };
}

/**
 * โพสต์ทันที (publish=true) — ไม่ตั้ง scheduled_publish_time
 */
export async function publishPost({ pageId, token, message, mediaIds }) {
  if (DRY_RUN) {
    const id = `dry_post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info({ pageId, mediaIds }, '[dry-run] mock publish post');
    return { id };
  }
  return limiter(async () => {
    const form = new FormData();
    form.append('access_token', token);
    form.append('message', message);
    mediaIds.forEach((id, i) => form.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    form.append('published', 'true');
    const data = await graphPost(`${pageId}/feed`, form);
    logger.info({ id: data.id, pageId, mediaIds }, 'published post');
    return data;
  });
}

/** ดึงรายการ Page ที่ user token เข้าถึงได้ (สำหรับ import) */
export async function fetchPages(userToken) {
  const data = await jsonFetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
  );
  if (data?.error) throw new Error(formatGraphError(data));
  return (data.data || []).map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token }));
}

/** ทดสอบว่า token ใช้ได้กับ page นั้นหรือไม่ */
export async function testPage(pageId, token) {
  if (DRY_RUN) return { ok: true, dryRun: true, pageName: '(dry-run)' };
  const data = await jsonFetch(`${GRAPH}/${pageId}?fields=name&access_token=${encodeURIComponent(token)}`);
  if (data?.error) throw new Error(formatGraphError(data));
  return { ok: true, pageName: data.name };
}
