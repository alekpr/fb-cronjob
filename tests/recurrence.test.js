import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence } from '../src/services/recurrence.js';
import { bkkDatetimeToUnix, unixToBkk } from '../src/utils/time.js';

test('daily: time already passed -> next day', () => {
  const after = bkkDatetimeToUnix('2026-10-30T10:00');
  assert.equal(unixToBkk(nextOccurrence({ type: 'daily', time: '08:00' }, after)), '2026-10-31 08:00');
});

test('daily: time not yet passed -> same day', () => {
  const after = bkkDatetimeToUnix('2026-10-30T10:00');
  assert.equal(unixToBkk(nextOccurrence({ type: 'daily', time: '12:00' }, after)), '2026-10-30 12:00');
});

test('weekly: all days -> next day at time', () => {
  const after = bkkDatetimeToUnix('2026-10-30T10:00');
  const ts = nextOccurrence({ type: 'weekly', time: '09:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }, after);
  assert.equal(unixToBkk(ts), '2026-10-31 09:00');
});

test('weekly: no matching day -> null', () => {
  const after = bkkDatetimeToUnix('2026-10-30T10:00');
  assert.equal(nextOccurrence({ type: 'weekly', time: '09:00', weekdays: [] }, after), null);
});

test('monthly: next month', () => {
  const after = bkkDatetimeToUnix('2026-01-31T10:00');
  assert.equal(
    unixToBkk(nextOccurrence({ type: 'monthly', time: '08:00', dayOfMonth: 15 }, after)),
    '2026-02-15 08:00',
  );
});

test('monthly: clamp to last day of month (Feb 28)', () => {
  const after = bkkDatetimeToUnix('2026-01-31T10:00');
  assert.equal(
    unixToBkk(nextOccurrence({ type: 'monthly', time: '08:00', dayOfMonth: 31 }, after)),
    '2026-02-28 08:00',
  );
});
