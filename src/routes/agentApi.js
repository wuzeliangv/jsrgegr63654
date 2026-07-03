const express = require('express');
const router = express.Router();
const path = require('path');
const logger = require('../services/logger');
const db = require('../services/database');
const { getDb } = require('../services/database');
const { safeTokenEqual } = require('../utils/securityTokens');
const { agentDownloadLimiter } = require('../middleware/rateLimit');

// 用 agent_token 反查所属节点 id(timing-safe,先按长度过滤候选)
function resolveNodeIdByAgentToken(token) {
  if (!token) return null;
  const d = getDb();
  const tokenLength = String(token).length;
  const rows = d.prepare('SELECT id, agent_token FROM nodes WHERE agent_token IS NOT NULL AND length(agent_token) = ?').all(tokenLength);
  for (const row of rows) {
    if (safeTokenEqual(token, row.agent_token)) return row.id;
  }
  return null;
}

router.get('/download', agentDownloadLimiter, (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return res.status(401).send('Unauthorized');

    const d = getDb();
    const tokenLength = String(token).length;
    const nodeTokenRows = d.prepare('SELECT agent_token FROM nodes WHERE agent_token IS NOT NULL AND length(agent_token) = ?').all(tokenLength);
    const nodeTokenMatch = nodeTokenRows.some((row) => safeTokenEqual(token, row.agent_token));
    if (!nodeTokenMatch) {
      return res.status(403).send('Forbidden');
    }

    const agentPath = path.join(__dirname, '..', '..', 'node-agent', 'agent.js');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(agentPath);
  } catch (err) {
    logger.error({ err }, 'Agent 下载失败');
    return res.status(500).send('Internal Server Error');
  }
});

// 节点 core 拉取本节点的有效用户表:[{ userId, uuid, username }]
// 鉴权:Authorization: Bearer <节点 agent_token>
// 返回的用户已由 getNodeAllUserUuids 过滤(未封禁/未冻结/trust_level >= 节点 min_level)
router.get('/users', (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const nodeId = resolveNodeIdByAgentToken(token);
    if (!nodeId) return res.status(403).json({ error: 'Forbidden' });

    // 确保该节点下所有合格用户都已分配 uuid(新用户/新节点首次拉取时补齐)
    db.ensureAllUsersHaveUuid(nodeId);

    const rows = db.getNodeAllUserUuids(nodeId);
    const users = rows.map((r) => ({ userId: r.user_id, uuid: r.uuid, username: r.username }));

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ nodeId, count: users.length, users });
  } catch (err) {
    logger.error({ err }, 'Agent 拉取用户表失败');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
