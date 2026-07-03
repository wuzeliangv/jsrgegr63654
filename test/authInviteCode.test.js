const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

const db = require('../src/services/database');
const mailer = require('../src/services/mailer');
const configEvents = require('../src/services/configEvents');
const authRoutePath = require.resolve('../src/routes/auth');

function loadFreshAuthRoutes() {
  delete require.cache[authRoutePath];
  return require('../src/routes/auth');
}

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

test('POST /auth/send-email-code rejects non-first-user registration without invite code', async (t) => {
  t.mock.method(db, 'getUserByEmail', () => null);
  t.mock.method(db, 'getAllUsers', () => []);
  t.mock.method(db, 'getUserCount', () => 1);
  t.mock.method(db, 'getSetting', (key) => {
    if (key === 'registration_open') return 'true';
    if (key === 'invite_registration_enabled') return 'true';
    if (key === 'allowed_email_domains') return '';
    return '';
  });
  t.mock.method(db, 'getUsableInviteCode', () => null);
  t.mock.method(mailer, 'sendMail', async () => {
    throw new Error('sendMail should not be called');
  });

  const app = express();
  app.use(express.json());
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const resp = await fetch(`${baseUrl}/auth/send-email-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com' }),
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: false, error: '请输入邀请码' });
});

test('POST /auth/email-register consumes invite code for non-first user registration', async (t) => {
  let capturedInviteCode = '';
  let sendMailCalls = 0;

  t.mock.method(crypto, 'randomInt', () => 123456);
  t.mock.method(db, 'getUserByEmail', () => null);
  t.mock.method(db, 'getAllUsers', () => []);
  t.mock.method(db, 'getUserByUsername', () => null);
  t.mock.method(db, 'getUserCount', () => 1);
  t.mock.method(db, 'getSetting', (key) => {
    if (key === 'registration_open') return 'true';
    if (key === 'invite_registration_enabled') return 'true';
    if (key === 'allowed_email_domains') return '';
    return '';
  });
  t.mock.method(db, 'getUsableInviteCode', (code) => (String(code || '').toUpperCase() === 'INVITE24' ? { id: 9, code: 'INVITE24' } : null));
  t.mock.method(db, 'createInvitedEmailUser', ({ inviteCode }) => {
    capturedInviteCode = inviteCode;
    return { id: 7, username: 'newuser', is_blocked: 0 };
  });
  t.mock.method(db, 'addAuditLog', () => {});
  t.mock.method(configEvents, 'emitSyncAll', () => {});
  t.mock.method(mailer, 'sendMail', async () => {
    sendMailCalls++;
  });

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    req.logIn = (user, cb) => {
      req.user = user;
      cb(null);
    };
    next();
  });
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const sendResp = await fetch(`${baseUrl}/auth/send-email-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', inviteCode: 'INVITE24' }),
  });
  assert.equal(sendResp.status, 200);
  assert.deepEqual(await sendResp.json(), { ok: true });
  assert.equal(sendMailCalls, 1);

  const registerResp = await fetch(`${baseUrl}/auth/email-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'new@example.com',
      inviteCode: 'invite24',
      code: '123456',
      password: 'abcDEF123!',
      passwordConfirm: 'abcDEF123!',
    }),
    redirect: 'manual',
  });

  assert.equal(registerResp.status, 302);
  assert.equal(registerResp.headers.get('location'), '/');
  assert.equal(capturedInviteCode, 'INVITE24');
});

test('POST /auth/generate-invite-code returns current invite when daily limit is reached', async (t) => {
  t.mock.method(db, 'getDb', () => ({
    prepare: () => ({ run: () => ({ changes: 1 }) }),
  }));
  t.mock.method(db, 'generateInviteCodeForUser', () => ({
    ok: false,
    invite: { code: 'ABC123XYZ', expires_at: '2026-03-17 12:00:00' },
    nextGenerateAt: '2026-03-17 12:00:00',
  }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, is_blocked: 0, trust_level: 1 };
    req.isAuthenticated = () => true;
    req.session = { csrfToken: 'test-csrf-token' };
    next();
  });
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const resp = await fetch(`${baseUrl}/auth/generate-invite-code`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': 'test-csrf-token' },
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), {
    ok: false,
    error: '每周只能生成一个邀请码',
    invite: { code: 'ABC123XYZ', expires_at: '2026-03-17 12:00:00' },
    nextGenerateAt: '2026-03-17 12:00:00',
  });
});

test('POST /auth/generate-invite-code rejects non-vip user', async (t) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, is_blocked: 0, trust_level: 0 };
    req.isAuthenticated = () => true;
    req.session = { csrfToken: 'test-csrf-token' };
    next();
  });
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const resp = await fetch(`${baseUrl}/auth/generate-invite-code`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': 'test-csrf-token' },
  });
  assert.equal(resp.status, 403);
  assert.deepEqual(await resp.json(), {
    ok: false,
    error: '仅 VIP 及以上等级可生成邀请码',
  });
});

test('POST /auth/send-email-code rejects when invite registration is closed', async (t) => {
  t.mock.method(db, 'getUserByEmail', () => null);
  t.mock.method(db, 'getAllUsers', () => []);
  t.mock.method(db, 'getUserCount', () => 1);
  t.mock.method(db, 'getSetting', (key) => {
    if (key === 'registration_open') return 'true';
    if (key === 'invite_registration_enabled') return 'false';
    if (key === 'allowed_email_domains') return '';
    return '';
  });
  let sendMailCalls = 0;
  t.mock.method(mailer, 'sendMail', async () => {
    sendMailCalls++;
  });

  const app = express();
  app.use(express.json());
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const resp = await fetch(`${baseUrl}/auth/send-email-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.com', inviteCode: 'INVITE24' }),
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: true });
  assert.equal(sendMailCalls, 1);
});

test('POST /auth/send-email-code returns smtp auth failure details', async (t) => {
  t.mock.method(db, 'getUserByEmail', () => null);
  t.mock.method(db, 'getAllUsers', () => []);
  t.mock.method(db, 'getUserCount', () => 1);
  t.mock.method(db, 'getSetting', (key) => {
    if (key === 'registration_open') return 'true';
    if (key === 'invite_registration_enabled') return 'true';
    if (key === 'allowed_email_domains') return 'gmail.com';
    return '';
  });
  t.mock.method(db, 'getUsableInviteCode', () => ({ id: 9, code: 'INVITE24' }));
  t.mock.method(mailer, 'sendMail', async () => {
    const err = new Error('Invalid login: 535 Authentication failed');
    err.code = 'EAUTH';
    err.responseCode = 535;
    throw err;
  });

  const app = express();
  app.use(express.json());
  app.use('/auth', loadFreshAuthRoutes());

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const resp = await fetch(`${baseUrl}/auth/send-email-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@gmail.com', inviteCode: 'INVITE24' }),
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { ok: false, error: '邮件服务认证失败，请检查后台 SMTP 用户名或密码' });
});
