const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

test('GET /admin/api/invite-relations returns paged invite relations with display fields', async (t) => {
  const routePath = require.resolve('../src/routes/admin/adminInvites');
  const dbPath = require.resolve('../src/services/database');
  const prevRoute = require.cache[routePath];
  const prevDb = require.cache[dbPath];

  delete require.cache[routePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getInviteRelationsPaged: (limit, offset, search, status) => {
        assert.equal(limit, 20);
        assert.equal(offset, 20);
        assert.equal(search, 'alice');
        assert.equal(status, 'used');
        return {
          total: 1,
          rows: [{
            id: 1,
            code: 'HELLO123',
            inviter_username: 'alice',
            inviter_email: 'alice@example.com',
            invitee_username: 'bob',
            invitee_email: 'bob@example.com',
            status: 'used',
            created_at: '2026-03-16 00:00:00',
            expires_at: '2026-03-17 00:00:00',
            used_at: '2026-03-16 01:00:00',
          }],
        };
      },
    },
  };

  try {
    const router = require('../src/routes/admin/adminInvites');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 1, is_admin: 1, is_blocked: 0 };
      req.isAuthenticated = () => true;
      next();
    });
    app.use('/admin/api', router);

    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/admin/api/invite-relations?page=2&search=alice&status=used`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.total, 1);
    assert.equal(data.page, 2);
    assert.equal(data.status, 'used');
    assert.equal(data.rows[0].code, 'HELLO123');
    assert.equal(data.rows[0].status, 'used');
    assert.match(data.rows[0].created_at_display, /^2026-03-16/);
    assert.match(data.rows[0].expires_at_display, /^2026-03-17/);
    assert.match(data.rows[0].used_at_display, /^2026-03-16/);
  } finally {
    delete require.cache[routePath];
    if (prevRoute) require.cache[routePath] = prevRoute; else delete require.cache[routePath];
    if (prevDb) require.cache[dbPath] = prevDb; else delete require.cache[dbPath];
  }
});
