const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'test-session-secret';
const db = require('../src/services/database');
const statsRoute = require('../src/routes/stats');

const { resolveVisibleOnlineSummary } = statsRoute._test;

test('resolveVisibleOnlineSummary counts unique users on visible nodes only', () => {
  const origGetAllNodes = db.getAllNodes;

  try {
    db.getAllNodes = () => ([
      { id: 1, min_level: 0 },
      { id: 2, min_level: 2 },
      { id: 3, min_level: 5 },
    ]);

    const user = { id: 100, trust_level: 1 };
    const cache = {
      summary: { online: 99, nodes: 3 },
      full: {
        nodeUsers: new Map([
          [1, new Set([10, 11])],
          [2, new Set([11, 12])],
          [3, new Set([13])],
        ]),
      },
    };
    const got = resolveVisibleOnlineSummary(user, cache);
    assert.deepEqual(got, { online: 2, nodes: 1 });
  } finally {
    db.getAllNodes = origGetAllNodes;
  }
});

test('resolveVisibleOnlineSummary falls back to summary when full cache missing', () => {
  const got = resolveVisibleOnlineSummary({ id: 1, trust_level: 0 }, { summary: { online: 7, nodes: 9 } });
  assert.deepEqual(got, { online: 7, nodes: 9 });
});
