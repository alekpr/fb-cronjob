import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, '..');
export const UPLOADS_MEDIA = path.join(ROOT, 'uploads', 'media');
export const DATA_DIR = path.join(ROOT, 'data');
export const PUBLIC_DIR = path.join(__dirname, 'public');

export function ensureDirs() {
  for (const dir of [UPLOADS_MEDIA, DATA_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
