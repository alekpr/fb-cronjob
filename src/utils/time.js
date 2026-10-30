import { DateTime } from 'luxon';

export const TIMEZONE = process.env.TIMEZONE || 'Asia/Bangkok';

export function nowIso() {
  return new Date().toISOString();
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** แปลง 'YYYY-MM-DDTHH:mm' (ตาม TIMEZONE) เป็น Unix timestamp (วินาที) */
export function bkkDatetimeToUnix(datetime) {
  const dt = DateTime.fromISO(datetime, { zone: TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`วันที่/เวลาไม่ถูกต้อง: ${datetime} (${dt.invalidReason})`);
  }
  return Math.floor(dt.toSeconds());
}

/** Unix timestamp -> 'YYYY-MM-DD HH:mm' ตาม timezone ที่ตั้ง */
export function unixToBkk(ts) {
  if (!Number.isFinite(ts)) return '';
  return DateTime.fromSeconds(ts, { zone: TIMEZONE }).toFormat('yyyy-MM-dd HH:mm');
}

export function bkkNow() {
  return DateTime.now().setZone(TIMEZONE).toFormat('yyyy-MM-dd HH:mm');
}
