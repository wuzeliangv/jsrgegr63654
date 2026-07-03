const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../../services/database');
const agentWs = require('../../services/agent-ws');
const { parseIntId } = require('../../utils/validators');
const { asyncHandler } = require('../../utils/asyncHandler');

const router = express.Router();

router.get('/agents', (req, res) => {
  res.json({ agents: agentWs.getConnectedAgents() });
});

// 允许通过面板转发的 Agent 指令类型白名单
const ALLOWED_COMMAND_TYPES = new Set([
  'ping', 'restart_xray', 'update_config', 'self_update',
]);

router.post('/agents/:nodeId/command', asyncHandler(async (req, res) => {
  const nodeId = parseIntId(req.params.nodeId);
  if (!nodeId) return res.status(400).json({ error: '参数错误' });
  const command = req.body;
  if (!command || !command.type) return res.status(400).json({ error: '缺少 command.type' });
  if (!ALLOWED_COMMAND_TYPES.has(command.type)) {
    return res.status(403).json({ error: `指令类型不允许: ${command.type}` });
  }
  const result = await agentWs.sendCommand(nodeId, command);
  db.addAuditLog(req.user.id, 'agent_command', `节点#${nodeId} 指令: ${command.type}`, req.clientIp || req.ip);
  res.json(result);
}));

router.post('/agent-token/regenerate', (req, res) => {
  const nodes = db.getAllNodes();
  for (const node of nodes) {
    db.updateNode(node.id, { agent_token: uuidv4() });
  }
  db.addAuditLog(req.user.id, 'agent_token_regen', `重新生成所有节点 Agent Token (${nodes.length} 个)`, req.clientIp || req.ip);
  res.json({ nodesUpdated: nodes.length });
});

module.exports = router;
