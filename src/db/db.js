import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR, ensureDirs } from '../paths.js';
import { nowIso } from '../utils/time.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  message TEXT NOT NULL,
  media_files TEXT NOT NULL DEFAULT '[]',
  recurrence_type TEXT NOT NULL DEFAULT 'once',
  recurrence_time TEXT,
  recurrence_weekdays TEXT,
  recurrence_day_of_month INTEGER,
  next_run_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  fb_post_id TEXT,
  error_message TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run_at);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  page_id TEXT,
  page_name TEXT,
  message TEXT,
  fb_post_id TEXT,
  success INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);
`;

let db;

export function getDb() {
  if (!db) {
    ensureDirs();
    db = new DatabaseSync(path.join(DATA_DIR, 'scheduler.db'));
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);
  }
  return db;
}

function rows(sql, ...params) {
  return getDb().prepare(sql).all(...params);
}

function one(sql, ...params) {
  return getDb().prepare(sql).get(...params);
}

function run(sql, ...params) {
  return getDb().prepare(sql).run(...params);
}

// ---- Pages ----

export function createPage({ id, name, accessToken, isDefault = false }) {
  const { n } = one('SELECT COUNT(*) AS n FROM pages');
  const makeDefault = isDefault || n === 0;
  if (makeDefault) run('UPDATE pages SET is_default = 0');
  run(
    'INSERT INTO pages (id, name, access_token, is_default, created_at) VALUES (?, ?, ?, ?, ?)',
    id,
    name,
    accessToken,
    makeDefault ? 1 : 0,
    nowIso(),
  );
  return findPage(id);
}

/** คืนรายการเพจแบบไม่มี access_token (ปลอดภัยสำหรับ API) */
export function listPages() {
  return rows('SELECT id, name, is_default, created_at FROM pages ORDER BY is_default DESC, name COLLATE NOCASE');
}

export function findPage(id) {
  return one('SELECT * FROM pages WHERE id = ?', id);
}

export function getDefaultPage() {
  return one('SELECT * FROM pages WHERE is_default = 1 LIMIT 1');
}

export function deletePage(id) {
  run('DELETE FROM pages WHERE id = ?', id);
}

export function setDefaultPage(id) {
  run('UPDATE pages SET is_default = 0');
  run('UPDATE pages SET is_default = 1 WHERE id = ?', id);
  return findPage(id);
}

export function upsertPage({ id, name, accessToken }) {
  const existing = findPage(id);
  if (existing) {
    run('UPDATE pages SET name = ?, access_token = ? WHERE id = ?', name, accessToken, id);
  } else {
    createPage({ id, name, accessToken });
  }
  return findPage(id);
}

// ---- Jobs ----

export function createJob({
  id,
  pageId,
  message,
  mediaFiles = [],
  recurrenceType = 'once',
  recurrenceTime = null,
  recurrenceWeekdays = null,
  recurrenceDayOfMonth = null,
  nextRunAt,
}) {
  const now = nowIso();
  run(
    `INSERT INTO jobs
      (id, page_id, message, media_files, recurrence_type, recurrence_time, recurrence_weekdays, recurrence_day_of_month, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    pageId,
    message,
    JSON.stringify(mediaFiles),
    recurrenceType,
    recurrenceTime,
    recurrenceWeekdays ? JSON.stringify(recurrenceWeekdays) : null,
    recurrenceDayOfMonth,
    nextRunAt,
    now,
    now,
  );
  return findJob(id);
}

export function findJob(id) {
  return one('SELECT * FROM jobs WHERE id = ?', id);
}

export function listJobs() {
  return rows(
    `SELECT j.*, p.name AS page_name
     FROM jobs j LEFT JOIN pages p ON p.id = j.page_id
     ORDER BY j.created_at DESC`,
  );
}

export function listDueJobs(nowSec) {
  return rows(
    `SELECT j.*, p.name AS page_name
     FROM jobs j LEFT JOIN pages p ON p.id = j.page_id
     WHERE j.status = 'queued' AND j.next_run_at <= ?
     ORDER BY j.next_run_at ASC`,
    nowSec,
  );
}

export function updateJob(id, fields) {
  const allowed = [
    'page_id',
    'message',
    'media_files',
    'recurrence_type',
    'recurrence_time',
    'recurrence_weekdays',
    'recurrence_day_of_month',
    'next_run_at',
    'status',
    'fb_post_id',
    'error_message',
    'run_count',
    'last_run_at',
  ];
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    if (key === 'media_files' || key === 'recurrence_weekdays') {
      params.push(value == null ? null : JSON.stringify(value));
    } else {
      params.push(value);
    }
  }
  if (!sets.length) return findJob(id);
  sets.push('updated_at = ?');
  params.push(nowIso());
  params.push(id);
  run(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return findJob(id);
}

export function deleteJob(id) {
  run('DELETE FROM jobs WHERE id = ?', id);
}

// ---- History ----

export function addHistory({ jobId, pageId, pageName, message, fbPostId, success, error }) {
  run(
    'INSERT INTO history (job_id, page_id, page_name, message, fb_post_id, success, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    jobId,
    pageId,
    pageName,
    message,
    fbPostId || null,
    success ? 1 : 0,
    error || null,
    nowIso(),
  );
}

export function listHistory(limit = 200) {
  return rows('SELECT * FROM history ORDER BY id DESC LIMIT ?', limit);
}
