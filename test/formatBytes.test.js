const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBytes } = require('../src/utils/formatBytes');

test('formatBytes returns 0 B for zero or negative input', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-10), '0 B');
});

test('formatBytes formats common units', () => {
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(1024 * 1024), '1.00 MB');
});

test('formatBytes supports PB upper bound', () => {
  assert.equal(formatBytes(1024 ** 5), '1.00 PB');
});
