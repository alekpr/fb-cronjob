import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { UPLOADS_MEDIA } from '../paths.js';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi']);

export function mediaDirFor(jobId) {
  return path.join(UPLOADS_MEDIA, jobId);
}

export function kindForExt(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

/** เอาเฉพาะชื่อไฟล์ ตัด path traversal + ตัวอักษรควบคุม */
export function sanitizeFilename(name) {
  const base = path.basename(String(name));
  const cleaned = base.replace(/[\\\u0000-\u001f]/g, '').trim();
  return cleaned || null;
}

/** เก็บไฟล์ media ที่อัปโหลดลง uploads/{jobId} (รองรับหลายไฟล์สำหรับ carousel) */
export function saveMedia(jobId, uploadedFiles) {
  const dir = mediaDirFor(jobId);
  mkdirSync(dir, { recursive: true });
  const warnings = [];
  const seen = new Set();

  for (const file of uploadedFiles) {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    const kind = kindForExt(ext);
    if (!kind) {
      warnings.push(`ข้ามไฟล์ที่ไม่รองรับ: ${file.originalname}`);
      continue;
    }
    const name = sanitizeFilename(file.originalname);
    if (!name) {
      warnings.push(`ข้ามชื่อไฟล์ไม่ถูกต้อง: ${file.originalname}`);
      continue;
    }
    const lower = name.toLowerCase();
    if (seen.has(lower)) {
      warnings.push(`ข้ามไฟล์ซ้ำ: ${name}`);
      continue;
    }
    seen.add(lower);
    writeFileSync(path.join(dir, name), readFileSync(file.path));
  }

  return { files: listMedia(jobId), warnings };
}

export function listMedia(jobId) {
  const dir = mediaDirFor(jobId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => {
      const full = path.join(dir, f);
      let st;
      try {
        st = statSync(full);
      } catch {
        return null;
      }
      if (!st.isFile()) return null;
      const ext = path.extname(f).slice(1).toLowerCase();
      return { filename: f, path: full, kind: kindForExt(ext), ext, size: st.size };
    })
    .filter(Boolean);
}

export function removeMedia(jobId) {
  rmSync(mediaDirFor(jobId), { recursive: true, force: true });
}
