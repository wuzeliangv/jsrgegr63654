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

test('GET /admin/api/users/:id/detail includes invited_by info when user was invited', async (t) => {
  const routePath = require.resolve('../src/routes/admin/adminUsers');
  const dbPath = require.resolve('../src/services/database');
  const prevRoute = require.cache[routePath];
  const prevDb = require.cache[dbPath];

  delete require.cache[routePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getUserById: (id) => id === 7 ? {
        id: 7,
        username: 'invitee',
        name: 'Invitee',
        trust_level: 0,
        is_admin: 0,
        is_blocked: 0,
        is_frozen: 0,
        last_login: '2026-03-16 08:00:00',
        created_at: '2026-03-16 07:00:00',
        expires_at: null,
        traffic_limit: 1073741824,
      } : null,
      getDb: () => ({
        prepare: (sql) => {
          if (sql.includes('FROM invite_codes ic')) {
            return {
              get: () => ({
                code: 'HELLO123',
                created_at: '2026-03-16 06:00:00',
                inviter_id: 1,
                inviter_username: 'alice',
                inviter_email: 'alice@example.com',
              }),
            };
          }
          return {
            get: () => ({ up: 0, down: 0, v: 0 }),
            all: () => [],
          };
        },
      }),
      getSubAccessUserDetail: () => ({ ips: [], uas: [], timeline: [] }),
      getSetting: () => '0',
    },
  };

  try {
    const router = require('../src/routes/admin/adminUsers');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: 1, is_admin: 1, is_blocked: 0 };
      req.isAuthenticated = () => true;
      next();
    });
    app.use('/admin/api', router);

    const { server, baseUrl } = await startServer(app);
    t.after(() => new Promise((resolve) => server.close(resolve)));

    const resp = await fetch(`${baseUrl}/admin/api/users/7/detail`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.info.username, 'invitee');
    assert.deepEqual(data.info.invited_by, {
      code: 'HELLO123',
      inviter_id: 1,
      inviter_username: 'alice',
      inviter_email: 'alice@example.com',
      created_at_display: '2026-03-16 14:00:00',
    });
  } finally {
    delete require.cache[routePath];
    if (prevRoute) require.cache[routePath] = prevRoute; else delete require.cache[routePath];
    if (prevDb) require.cache[dbPath] = prevDb; else delete require.cache[dbPath];
  }
});
