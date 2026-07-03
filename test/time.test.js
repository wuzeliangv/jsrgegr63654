const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toSqlUtc,
  dateKeyInTimeZone,
  dateKeyDaysAgo,
  formatDateTimeInTimeZone,
  parseDateInput,
  normalizeLegacyLocalSqlToUtc,
} = require('../src/utils/time');

test('toSqlUtc formats timestamp as UTC SQL datetime', () => {
  const value = toSqlUtc('2026-02-27T16:30:45.123Z');
  assert.equal(value, '2026-02-27 16:30:45');
});

test('dateKeyInTimeZone returns expected date in Asia/Shanghai', () => {
  const value = dateKeyInTimeZone('2026-02-27T16:30:45.123Z', 'Asia/Shanghai');
  assert.equal(value, '2026-02-28');
});

test('dateKeyDaysAgo shifts by day count in target timezone', () => {
  const value = dateKeyDaysAgo(6, 'Asia/Shanghai', '2026-03-01T01:00:00.000Z');
  assert.equal(value, '2026-02-23');
});

test('formatDateTimeInTimeZone returns minute precision by default', () => {
  const value = formatDateTimeInTimeZone('2026-02-27T16:30:45.123Z', 'Asia/Shanghai');
  assert.equal(value, '2026-02-28 00:30');
});

test('formatDateTimeInTimeZone can include seconds', () => {
  const value = formatDateTimeInTimeZone('2026-02-27T16:30:45.123Z', 'Asia/Shanghai', true);
  assert.equal(value, '2026-02-28 00:30:45');
});

test('parseDateInput treats SQL datetime string as UTC', () => {
  const d = parseDateInput('2026-02-27 16:30:45');
  assert.equal(d.toISOString(), '2026-02-27T16:30:45.000Z');
});

test('normalizeLegacyLocalSqlToUtc keeps normal UTC-ish SQL time', () => {
  const value = normalizeLegacyLocalSqlToUtc('2026-03-01 01:00:00', 8, 4, '2026-03-01T02:00:00.000Z');
  assert.equal(value, '2026-03-01 01:00:00');
});

test('normalizeLegacyLocalSqlToUtc fixes legacy localtime SQL when parsed as future UTC', () => {
  const value = normalizeLegacyLocalSqlToUtc('2026-03-01 09:48:32', 8, 4, '2026-03-01T02:00:00.000Z');
  assert.equal(value, '2026-03-01 01:48:32');
});
