import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { UPLOADS_MEDIA } from '../paths.js';
import {
  createJob,
  deleteJob,
  findJob,
  findPage,
  getDefaultPage,
  listHistory,
  listJobs,
  updateJob,
} from '../db/db.js';
import { removeMedia, saveMedia } from '../services/mediaService.js';
import { nextOccurrence, parseArr, recurrenceLabel } from '../services/recurrence.js';
import { computeNextRun, triggerJob } from '../services/scheduler.js';
import { bkkDatetimeToUnix, nowSec } from '../utils/time.js';

const router = Router();

/** แก้ชื่อไฟล์ภาษาไทยที่ multer/busboy ตีความเป็น latin1 ผิดเพี้ยน */
function decodeName(name) {
  if (/[\u0080-\u00ff]/.test(name)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) return decoded;
  }
  return name;
}

function createUploader(tmpDir) {
  mkdirSync(tmpDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${decodeName(file.originalname)}`),
  });
  return multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
}

function buildMessage(message, hashtags) {
  const m = String(message || '').trim();
  const h = String(hashtags || '').trim();
  return h ? `${m} ${h}` : m;
}

function parseWeekdays(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try {
    const p = JSON.parse(value);
    if (Array.isArray(p)) return p.map(Number).filter(Number.isFinite);
  } catch {
    /* ignore */
  }
  return String(value).split(',').map(Number).filter(Number.isFinite);
}

function computeNextRunAt({ scheduleType, time, weekdays, dayOfMonth, datetime }) {
  const now = nowSec();
  if (scheduleType === 'once') {
    if (!datetime) throw new Error('กรุณาเลือกวัน-เวลาโพสต์');
    const ts = bkkDatetimeToUnix(datetime);
    if (ts <= now) throw new Error('วัน-เวลาต้องอยู่ในอนาคต');
    return ts;
  }
  if (!time) throw new Error('กรุณาระบุเวลาโพสต์');
  const ts = nextOccurrence(
    {
      type: scheduleType,
      time,
      weekdays: parseWeekdays(weekdays),
      dayOfMonth: Number(dayOfMonth),
    },
    now,
  );
  if (ts == null) throw new Error('ข้อมูลตารางเวลาซ้ำไม่ถูกต้อง');
  return ts;
}

router.post('/jobs', (req, res) => {
  const jobId = randomUUID();
  const tmpDir = path.join(UPLOADS_MEDIA, '..', 'tmp', jobId);
  const upload = createUploader(tmpDir).fields([{ name: 'media', maxCount: 20 }]);

  upload(req, res, (err) => {
    if (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 2 GB' : err.message;
      return res.status(400).json({ error: msg });
    }
    try {
      const body = req.body || {};
      const message = buildMessage(body.message, body.hashtags);
      if (!message) throw new Error('กรุณากรอกข้อความโพสต์');

      const mediaUploads = req.files?.media || [];
      const { files, warnings } = saveMedia(jobId, mediaUploads);

      const page = findPage(body.pageId) || getDefaultPage();
      if (!page) throw new Error('ยังไม่มีเพจ — ไปเพิ่มในแท็บ "ตั้งค่าเพจ" ก่อน');

      const nextRunAt = computeNextRunAt({
        scheduleType: body.scheduleType || 'once',
        time: body.time,
        weekdays: body.weekdays,
        dayOfMonth: body.dayOfMonth,
        datetime: body.datetime,
      });

      const job = createJob({
        id: jobId,
        pageId: page.id,
        message,
        mediaFiles: files.map((f) => f.filename),
        recurrenceType: body.scheduleType || 'once',
        recurrenceTime: body.time || null,
        recurrenceWeekdays: parseWeekdays(body.weekdays),
        recurrenceDayOfMonth: body.dayOfMonth ? Number(body.dayOfMonth) : null,
        nextRunAt,
      });

      res.status(201).json({ job: { ...job, recurrence_label: recurrenceLabel(job) }, warnings });
    } catch (err2) {
      removeMedia(jobId);
      res.status(400).json({ error: err2.message });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

router.get('/jobs', (_req, res) => {
  const jobs = listJobs().map((j) => ({
    ...j,
    media_files: parseArr(j.media_files),
    recurrence_label: recurrenceLabel(j),
  }));
  res.json({ jobs });
});

router.post('/jobs/:id/pause', (req, res) => {
  const job = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ไม่พบ job' });
  if (job.status !== 'queued') return res.status(400).json({ error: 'หยุดชั่วคราวได้เฉพาะ job สถานะ queued' });
  updateJob(job.id, { status: 'paused' });
  res.json(findJob(job.id));
});

router.post('/jobs/:id/resume', (req, res) => {
  const job = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ไม่พบ job' });
  if (job.status !== 'paused') return res.status(400).json({ error: 'ทำต่อได้เฉพาะ job สถานะ paused' });
  const now = nowSec();
  let nextRunAt = job.next_run_at;
  if (job.recurrence_type !== 'once' && nextRunAt <= now) {
    nextRunAt = computeNextRun(job, now) ?? now;
  }
  updateJob(job.id, { status: 'queued', next_run_at: nextRunAt, error_message: null });
  res.json(findJob(job.id));
});

router.post('/jobs/:id/run-now', (req, res) => {
  const job = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ไม่พบ job' });
  if (job.status === 'publishing') return res.status(400).json({ error: 'job นี้กำลังรันอยู่' });
  updateJob(job.id, { status: 'queued', error_message: null });
  triggerJob(job.id);
  res.json({ ok: true });
});

router.delete('/jobs/:id', (req, res) => {
  const job = findJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'ไม่พบ job' });
  deleteJob(job.id);
  removeMedia(job.id);
  res.json({ ok: true });
});

router.get('/history', (req, res) => {
  const limit = Number(req.query.limit) || 200;
  res.json({ history: listHistory(Math.min(limit, 1000)) });
});

export default router;
