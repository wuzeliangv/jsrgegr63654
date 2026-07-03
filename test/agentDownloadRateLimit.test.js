const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test('agent download limiter throttles burst requests', async (t) => {
  const oldWindow = process.env.AGENT_DOWNLOAD_WINDOW_MS;
  const oldMax = process.env.AGENT_DOWNLOAD_MAX_REQ;
  process.env.AGENT_DOWNLOAD_WINDOW_MS = '60000';
  process.env.AGENT_DOWNLOAD_MAX_REQ = '2';

  const modulePath = require.resolve('../src/middleware/rateLimit');
  delete require.cache[modulePath];
  const { agentDownloadLimiter } = require('../src/middleware/rateLimit');

  const app = express();
  app.get('/api/agent/download', agentDownloadLimiter, (_req, res) => {
    res.status(200).send('ok');
  });

  const { server, baseUrl } = await startServer(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => {
    delete require.cache[modulePath];
    if (oldWindow == null) delete process.env.AGENT_DOWNLOAD_WINDOW_MS;
    else process.env.AGENT_DOWNLOAD_WINDOW_MS = oldWindow;
    if (oldMax == null) delete process.env.AGENT_DOWNLOAD_MAX_REQ;
    else process.env.AGENT_DOWNLOAD_MAX_REQ = oldMax;
  });

  const r1 = await fetch(`${baseUrl}/api/agent/download`);
  const r2 = await fetch(`${baseUrl}/api/agent/download`);
  const r3 = await fetch(`${baseUrl}/api/agent/download`);

  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r3.status, 429);
  const body = await r3.json();
  assert.deepEqual(body, { error: 'Agent 下载请求过于频繁，请稍后再试' });
});
