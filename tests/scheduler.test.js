import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRun, isDue } from '../src/services/scheduler.js';
import { recurrenceLabel } from '../src/services/recurrence.js';
import { bkkDatetimeToUnix } from '../src/utils/time.js';

test('isDue: past/equal due, future not', () => {
  const now = bkkDatetimeToUnix('2026-10-30T10:00');
  assert.equal(isDue(now - 1, now), true);
  assert.equal(isDue(now, now), true);
  assert.equal(isDue(now + 1, now), false);
});

test('computeNextRun: once -> null', () => {
  assert.equal(computeNextRun({ recurrence_type: 'once' }, 0), null);
});

test('computeNextRun: daily -> future timestamp', () => {
  const job = {
    recurrence_type: 'daily',
    recurrence_time: '08:00',
    recurrence_weekdays: null,
    recurrence_day_of_month: null,
  };
  const now = bkkDatetimeToUnix('2026-10-30T10:00');
  const next = computeNextRun(job, now);
  assert.ok(next > now);
});

test('recurrenceLabel', () => {
  assert.equal(recurrenceLabel({ recurrence_type: 'daily', recurrence_time: '12:00' }), 'ทุกวัน 12:00');
  assert.equal(recurrenceLabel({ recurrence_type: 'once', recurrence_time: null }), 'ครั้งเดียว');
  assert.equal(
    recurrenceLabel({ recurrence_type: 'monthly', recurrence_time: '08:00', recurrence_day_of_month: 15 }),
    'ทุกเดือน วันที่ 15 08:00',
  );
});
