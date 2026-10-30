import { DateTime } from 'luxon';
import { TIMEZONE } from '../utils/time.js';

/**
 * คำนวณเวลารันถัดไป (Unix วินาที) ของ recurring rule
 * @param {{type:'daily'|'weekly'|'monthly', time:'HH:mm', weekdays?:number[], dayOfMonth?:number}} rule
 * @param {number} afterTsSec — คำนวณรอบที่มากกว่าจุดเวลานี้อย่างเคร่งครัด
 * @returns {number|null} unix seconds
 */
export function nextOccurrence(rule, afterTsSec) {
  const [hh, mm] = String(rule.time).split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

  const after = DateTime.fromSeconds(afterTsSec, { zone: TIMEZONE });
  const base = after.startOf('day').set({ hour: hh, minute: mm, second: 0, millisecond: 0 });

  switch (rule.type) {
    case 'daily': {
      let d = base;
      if (d.toSeconds() <= afterTsSec) d = d.plus({ days: 1 });
      return d.toSeconds();
    }
    case 'weekly': {
      const days = new Set((rule.weekdays || []).map(Number));
      if (!days.size) return null;
      for (let i = 0; i <= 7; i += 1) {
        const d = base.plus({ days: i });
        if (d.toSeconds() <= afterTsSec) continue;
        // luxon weekday: 1=จันทร์..7=อาทิตย์ → %7 ได้ค่าแบบ JS getDay (0=อาทิตย์)
        if (days.has(d.weekday % 7)) return d.toSeconds();
      }
      return null;
    }
    case 'monthly': {
      const dom = Number(rule.dayOfMonth);
      if (!Number.isFinite(dom)) return null;
      let d = after
        .startOf('month')
        .set({ day: Math.min(dom, after.daysInMonth), hour: hh, minute: mm, second: 0, millisecond: 0 });
      if (d.toSeconds() <= afterTsSec) {
        const nextMonth = after.startOf('month').plus({ months: 1 });
        d = nextMonth.set({
          day: Math.min(dom, nextMonth.daysInMonth),
          hour: hh,
          minute: mm,
          second: 0,
          millisecond: 0,
        });
      }
      return d.toSeconds();
    }
    default:
      return null;
  }
}

const DAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

export function recurrenceLabel(job) {
  const t = job.recurrence_time || '';
  switch (job.recurrence_type) {
    case 'daily':
      return `ทุกวัน ${t}`;
    case 'weekly': {
      const days = parseArr(job.recurrence_weekdays).map((d) => DAY_NAMES[d] || d);
      return `ทุกสัปดาห์ (${days.join(', ')}) ${t}`;
    }
    case 'monthly':
      return `ทุกเดือน วันที่ ${job.recurrence_day_of_month} ${t}`;
    default:
      return 'ครั้งเดียว';
  }
}

export function parseArr(s) {
  try {
    const a = JSON.parse(s || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
