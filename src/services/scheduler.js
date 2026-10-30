import {
  addHistory,
  findJob,
  findPage,
  listDueJobs,
  updateJob,
} from '../db/db.js';
import { listMedia } from './mediaService.js';
import { nextOccurrence, parseArr } from './recurrence.js';
import * as fb from './fbService.js';
import logger from '../utils/logger.js';

let timer = null;
let ticking = false;
let chain = Promise.resolve();

export function isDue(nextRunAt, nowSec = Math.floor(Date.now() / 1000)) {
  return Number.isFinite(nextRunAt) && nextRunAt <= nowSec;
}

/** คำนวณรอบถัดไปของ job (recurring) หรือ null ถ้าเป็นครั้งเดียว */
export function computeNextRun(job, nowSec) {
  if (!job || job.recurrence_type === 'once') return null;
  return nextOccurrence(
    {
      type: job.recurrence_type,
      time: job.recurrence_time,
      weekdays: parseArr(job.recurrence_weekdays),
      dayOfMonth: job.recurrence_day_of_month,
    },
    nowSec,
  );
}

export function startScheduler(intervalMs = 15000) {
  if (timer) return;
  logger.info({ intervalMs }, 'scheduler started');
  tick(); // ตรวจทันทีตอนเปิดเครื่อง (catch-up)
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** บังคับรัน job ทันที (สำหรับปุ่ม run-now) */
export function triggerJob(jobId) {
  chain = chain.then(() => processJob(jobId)).catch((err) => logger.error({ jobId, error: err.message }, 'trigger error'));
}

function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const due = listDueJobs(nowSec);
    for (const job of due) {
      chain = chain
        .then(() => processJob(job.id))
        .catch((err) => logger.error({ jobId: job.id, error: err.message }, 'process error'));
    }
  } finally {
    ticking = false;
  }
}

async function processJob(jobId) {
  const job = findJob(jobId);
  if (!job || job.status !== 'queued') return;

  updateJob(jobId, { status: 'publishing' });
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const post = await publishJob(job);
    const nextRun = computeNextRun(job, nowSec);
    const updates = {
      status: nextRun ? 'queued' : 'done',
      fb_post_id: post.id,
      error_message: null,
      run_count: (job.run_count ?? 0) + 1,
      last_run_at: nowSec,
    };
    if (nextRun) updates.next_run_at = nextRun; // once -> คงค่าเดิมไว้ (คอลัมน์ NOT NULL)
    updateJob(jobId, updates);
    addHistory({
      jobId,
      pageId: job.page_id,
      pageName: pageName(job.page_id),
      message: job.message,
      fbPostId: post.id,
      success: 1,
      error: null,
    });
    logger.info({ jobId, postId: post.id, nextRun }, 'published');
  } catch (err) {
    updateJob(jobId, { status: 'failed', error_message: err.message, last_run_at: nowSec });
    addHistory({
      jobId,
      pageId: job.page_id,
      pageName: pageName(job.page_id),
      message: job.message,
      fbPostId: null,
      success: 0,
      error: err.message,
    });
    logger.error({ jobId, error: err.message }, 'publish failed');
  }
}

async function publishJob(job) {
  const page = findPage(job.page_id);
  if (!page) throw new Error(`ไม่พบเพจ: ${job.page_id}`);

  const media = listMedia(job.id);
  const mediaIds = [];
  for (const mf of media) {
    const id =
      mf.kind === 'image'
        ? (await fb.uploadPhoto(page.id, page.access_token, mf.path, mf.filename)).id
        : (await fb.uploadVideo(page.id, page.access_token, mf.path, mf.filename)).id;
    mediaIds.push(id);
  }

  return fb.publishPost({
    pageId: page.id,
    token: page.access_token,
    message: job.message,
    mediaIds,
  });
}

function pageName(id) {
  const p = findPage(id);
  return p ? p.name : id;
}
