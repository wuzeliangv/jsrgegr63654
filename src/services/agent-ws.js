/**
 * WebSocket Agent 服务
 * 管理节点 agent 的 WebSocket 连接，接收上报数据，下发指令
 */
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const healthService = require('./health');
const { notify } = require('./notify');
const logger = require('./logger');
const { getClientIp } = require('../utils/clientIp');
const { nowUtcIso, toSqlUtc } = require('../utils/time');
const { safeTokenEqual } = require('../utils/securityTokens');

// 在线 agent 连接池：nodeId → { ws, nodeId, connectedAt, lastReport, reportData }
const agents = new Map();
// 节点连接指标：nodeId → { disconnectCount, lastDisconnectAt, lastReconnectAt, consecutiveReconnects }
const agentMetrics = new Map();
// 指标清理间隔：每小时清理已不再连接且无活跃的过期指标条目
const METRICS_CLEANUP_INTERVAL = 3600000;
const METRICS_STALE_THRESHOLD = 86400000; // 24 小时未更新视为过期

// 待响应的指令回调：cmdId → { resolve, reject, timer, nodeId }
const pendingCommands = new Map();

const AUTH_TIMEOUT = 10000; // 认证超时 10s
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 10000;
const CMD_TIMEOUT = 30000;

let wss = null;
let pingTimer = null;
let metricsCleanupTimer = null;

function getOrCreateMetrics(nodeId) {
  if (!agentMetrics.has(nodeId)) {
    agentMetrics.set(nodeId, {
      disconnectCount: 0,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      consecutiveReconnects: 0,
    });
  }
  return agentMetrics.get(nodeId);
}

function markDisconnected(nodeId) {
  const metrics = getOrCreateMetrics(nodeId);
  metrics.disconnectCount += 1;
  metrics.consecutiveReconnects += 1;
  metrics.lastDisconnectAt = nowUtcIso();
}

function cleanupPendingCommands(nodeId) {
  for (const [id, pending] of pendingCommands) {
    if (pending.nodeId !== nodeId) continue;
    clearTimeout(pending.timer);
    pendingCommands.delete(id);
    try {
      pending.resolve({ success: false, error: 'Agent 连接已断开' });
    } catch (err) {
      logger.debug({ err, nodeId, cmdId: id }, '回调 Agent 指令失败结果时出错，已忽略');
    }
  }
}

function handleNormalAuth(ws, msg) {
  const { token, nodeId, version, capabilities } = msg;
  if (!nodeId) {
    return ws.close(4004, '缺少 nodeId');
  }

  const node = db.getNodeById(nodeId);
  if (!node) {
    return ws.close(4006, '节点不存在');
  }

  const nodeToken = node.agent_token;
  const nodeTokenMatch = safeTokenEqual(token, nodeToken);
  if (!nodeTokenMatch) {
    // 检查是否使用了全局 token（仅用于日志警告，不再允许认证）
    const globalToken = db.getSetting('agent_token');
    const globalTokenMatch = safeTokenEqual(token, globalToken);
    if (globalTokenMatch) {
      logger.warn({ nodeId }, 'Agent-WS 认证失败：使用了全局 token，已废弃。请使用节点独立 agent_token');
    } else {
      logger.warn({ nodeId }, 'Agent-WS 认证失败：token 不匹配');
    }
    return ws.close(4005, '认证失败');
  }

  const old = agents.get(nodeId);
  if (old && old.ws !== ws) {
    try { old.ws.close(4007, '被新连接替代'); } catch (err) {
      logger.debug({ err, nodeId }, '关闭旧 Agent 连接失败，已忽略');
    }
  }

  clearTimeout(ws._authTimer);
  ws._agentState.authenticated = true;
  ws._agentState.nodeId = nodeId;

  const metrics = getOrCreateMetrics(nodeId);
  if (metrics.consecutiveReconnects > 0) {
    metrics.lastReconnectAt = nowUtcIso();
    metrics.consecutiveReconnects = 0;
  }

  agents.set(nodeId, {
    ws,
    nodeId,
    nodeName: node.name,
    ip: ws._agentState.ip,
    connectedAt: nowUtcIso(),
    lastReport: null,
    reportData: null,
    version: version || null,
    capabilities: capabilities || null,
    reconnectMetrics: { ...metrics },
    _pongReceived: true,
  });

  ws.send(JSON.stringify({ type: 'auth_ok' }));
  logger.info({ nodeId, nodeName: node.name }, 'Agent-WS 认证成功');
  db.addAuditLog(null, 'agent_online', `节点 Agent 上线: ${node.name} (${ws._agentState.ip})`, 'system');
}

/**
 * 初始化 WebSocket 服务，挂载到 HTTP server
 */
function init(server) {
  wss = new WebSocketServer({ server, path: '/ws/agent', maxPayload: 1 * 1024 * 1024 });

  wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    logger.info({ ip }, 'Agent-WS 新连接');

    ws._agentState = { authenticated: false, nodeId: null, ip, msgCount: 0, msgWindowStart: Date.now() };

    ws._authTimer = setTimeout(() => {
      if (!ws._agentState.authenticated) {
        logger.warn({ ip }, 'Agent-WS 认证超时，断开连接');
        ws.close(4001, '认证超时');
      }
    }, AUTH_TIMEOUT);

    ws.on('message', (raw) => {
      // 消息限速：每 10 秒最多 60 条
      const now = Date.now();
      if (now - ws._agentState.msgWindowStart > 10000) {
        ws._agentState.msgCount = 0;
        ws._agentState.msgWindowStart = now;
      }
      if (++ws._agentState.msgCount > 60) {
        logger.warn({ ip: ws._agentState.ip, nodeId: ws._agentState.nodeId }, 'Agent-WS 消息过于频繁，断开连接');
        return ws.close(4008, '消息频率过高');
      }
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return ws.close(4002, '无效 JSON');
      }
      handleMessage(ws, msg);
    });

    ws.on('close', () => {
      clearTimeout(ws._authTimer);
      const { nodeId } = ws._agentState;
      if (nodeId && agents.get(nodeId)?.ws === ws) {
        markDisconnected(nodeId);
        agents.delete(nodeId);
        cleanupPendingCommands(nodeId);
        logger.info({ nodeId }, 'Agent-WS 节点断开连接');
        setTimeout(() => {
          if (!agents.has(nodeId)) {
            try {
              const node = db.getNodeById(nodeId);
              if (node && node.is_active) {
                db.updateNode(nodeId, {
                  is_active: 0,
                  remark: '🔴 断开',
                  last_check: toSqlUtc(),
                });
                // 同机伙伴节点（SS/IPv6、Hy2）也标记离线
                const peerNodes = healthService.getPeerNodes(node);
                if (peerNodes.length > 0) {
                  healthService.mirrorPeerState(peerNodes, 0, '🔴 断开', nowUtcIso());
                }
                db.addAuditLog(null, 'agent_offline', `节点 Agent 断开: ${node.name}`, 'system');
                notify.nodeDown(`${node.name} (Agent 断开)`);
              }
            } catch (err) {
              logger.debug({ err, nodeId }, '处理 Agent 断线后节点状态回写失败，已忽略');
            }
          }
        }, 30000);
      }
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'Agent-WS 连接错误');
    });
  });

  pingTimer = setInterval(() => {
    for (const [nodeId, agent] of agents) {
      if (agent.ws.readyState !== 1) {
        markDisconnected(nodeId);
        agents.delete(nodeId);
        cleanupPendingCommands(nodeId);
        continue;
      }
      agent._pongReceived = false;
      try {
        agent.ws.send(JSON.stringify({ type: 'ping', id: uuidv4() }));
      } catch (err) {
        logger.debug({ err, nodeId }, '向 Agent 发送 ping 失败，连接将被回收');
        markDisconnected(nodeId);
        agents.delete(nodeId);
        cleanupPendingCommands(nodeId);
        continue;
      }
      setTimeout(() => {
        if (agents.has(nodeId) && !agents.get(nodeId)._pongReceived) {
          logger.warn({ nodeId }, 'Agent-WS pong 超时，断开连接');
          markDisconnected(nodeId);
          try { agent.ws.terminate(); } catch (err) {
            logger.debug({ err, nodeId }, '终止超时 Agent 连接失败，已忽略');
          }
          agents.delete(nodeId);
          cleanupPendingCommands(nodeId);
        }
      }, PONG_TIMEOUT);
    }
  }, PING_INTERVAL);

  logger.info({ path: '/ws/agent' }, 'Agent-WS 服务已启动');

  // 启动零流量被墙检测
  healthService.startZeroTrafficWatch();

  // 启动 Agent 上报超时巡检（防止静默断线后节点永远显示在线）
  healthService.startStaleAgentWatch();

  // 启动活跃节点突然零流量检测（快速发现被墙）
  healthService.startSuddenZeroTrafficWatch();

  // 定期清理过期的 agentMetrics 条目，防止内存泄漏
  metricsCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [nodeId, metrics] of agentMetrics) {
      if (agents.has(nodeId)) continue; // 在线节点不清理
      const lastActive = metrics.lastDisconnectAt || metrics.lastReconnectAt;
      if (!lastActive || now - new Date(lastActive).getTime() > METRICS_STALE_THRESHOLD) {
        agentMetrics.delete(nodeId);
      }
    }
  }, METRICS_CLEANUP_INTERVAL);
}

/**
 * 处理 agent 消息
 */
function handleMessage(ws, msg) {
  const { type } = msg;

  if (!ws._agentState.authenticated && type !== 'auth') {
    return ws.close(4003, '未认证');
  }

  switch (type) {
    case 'auth':
      handleAuth(ws, msg);
      break;
    case 'report':
      handleReport(ws, msg);
      break;
    case 'cmd_result':
      handleCmdResult(ws, msg);
      break;
    case 'pong':
    case 'heartbeat':
      handlePong(ws);
      break;
    default:
      logger.warn({ type }, 'Agent-WS 收到未知消息类型');
  }
}

/**
 * 处理认证（分发器）
 */
function handleAuth(ws, msg) {
  const { token } = msg;

  if (!token) {
    return ws.close(4004, '缺少 token');
  }

  // 已认证的连接拒绝重复认证
  if (ws._agentState.authenticated) {
    return;
  }

  return handleNormalAuth(ws, msg);
}

const _IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// 公网 IP 自动修正：agent 上报的公网 IPv4 与库中地址不一致时自动更新
// - IPv4 节点：更新 host + ssh_host（订阅与管理地址都是该 IPv4）
// - IPv6 节点：只更新 ssh_host（agent/管理走 IPv4），保留 host(IPv6) 不变 —— IPv6 不被墙无需换
// 同机多节点共用一个 agent：按旧 IPv4(ssh_host) 找出同机所有节点一起修正
function maybeAutoCorrectIp(nodeId, publicIp) {
  try {
    if (!publicIp || !_IPV4_RE.test(String(publicIp))) return; // 非合法公网 IPv4，忽略
    const node = db.getNodeById(nodeId);
    if (!node) return;
    // 上报节点的旧 IPv4 管理地址（同机基准）。优先 ssh_host，IPv4 节点回退到 host
    const oldV4 = String(node.ssh_host || (Number(node.ip_version) !== 6 ? node.host : '') || '');
    if (!oldV4 || !_IPV4_RE.test(oldV4)) return; // 没有合法旧 IPv4 基准
    if (oldV4 === publicIp) return; // 未变化

    // 同机节点：旧 IPv4 管理地址(ssh_host)与上报节点相同，或就是上报节点本身
    const targets = db.getAllNodes().filter(n =>
      n.id === nodeId || String(n.ssh_host || '') === oldV4
    );

    for (const t of targets) {
      const isV6 = Number(t.ip_version) === 6;
      const tOldSsh = String(t.ssh_host || '');
      const tOldHost = String(t.host || '');
      const fields = { ssh_host: publicIp };
      let hostNote = '';
      if (!isV6) {
        // IPv4 节点：host 也是该 IPv4（域名 host 则不动，避免覆盖）
        if (!tOldHost || _IPV4_RE.test(tOldHost)) { fields.host = publicIp; hostNote = `${tOldHost || '(空)'} -> ${publicIp}`; }
      }
      // 跳过完全无变化的
      if (fields.host === undefined && tOldSsh === publicIp) continue;
      db.updateNode(t.id, fields);
      const detail = isV6
        ? `节点 ${t.name} 管理IP(ssh)自动修正: ${tOldSsh || '(空)'} -> ${publicIp}（IPv6订阅地址不变）`
        : `节点 ${t.name} 公网IP自动修正: ${hostNote}`;
      db.addAuditLog(null, 'node_ip_autocorrect', detail, 'agent-report');
      logger.info({ nodeId: t.id, nodeName: t.name, isV6, oldSsh: tOldSsh, newIp: publicIp }, '节点IP自动修正');
      try { notify.nodeIpChanged(t.name + (isV6 ? '（管理IP）' : ''), tOldSsh || tOldHost || '(空)', publicIp); } catch (_) { /* 忽略通知失败 */ }
    }
  } catch (err) {
    logger.warn({ err: err.message, nodeId }, 'IP 自动修正失败');
  }
}

/**
 * 处理 agent 上报数据
 */
function handleReport(ws, msg) {
  const { nodeId } = ws._agentState;
  const agent = agents.get(nodeId);
  if (!agent) return;

  const { xrayAlive, serviceAlive, hysteriaAlive, cnReachable, ipv6Reachable, loadAvg, memUsage, diskUsage, trafficRecords, version, capabilities, reconnectMetrics, cpuUsage, netBandwidth, uptime, publicIp, abuseAlerts } = msg;
  // serviceAlive 为 xrayAlive 的中性别名(供非 Xray 的自研 core 使用);两者任一为真即视为存活
  const xrayAliveEff = (xrayAlive !== undefined) ? xrayAlive : serviceAlive;
  const now = nowUtcIso();

  const reportData = { xrayAlive: xrayAliveEff, hysteriaAlive, cnReachable, loadAvg, memUsage, diskUsage, cpuUsage, netBandwidth, uptime, netTotalRx: netBandwidth?.rxBytes ?? null, netTotalTx: netBandwidth?.txBytes ?? null, publicIp: publicIp ?? null, reportedAt: now };
  agent.lastReport = now;
  agent.reportData = reportData;
  if (version) agent.version = version;
  if (capabilities) agent.capabilities = capabilities;
  if (reconnectMetrics) {
    agent.reconnectMetrics = reconnectMetrics;
    const metrics = getOrCreateMetrics(nodeId);
    Object.assign(metrics, reconnectMetrics);
  } else {
    agent.reconnectMetrics = { ...getOrCreateMetrics(nodeId) };
  }

  healthService.updateFromAgentReport(nodeId, { xrayAlive: xrayAliveEff, hysteriaAlive, cnReachable, ipv6Reachable, loadAvg, memUsage, diskUsage, trafficRecords });

  // 公网 IP 自动修正：agent 上报的公网 IPv4 与库中 host 不一致时自动更新（仅 IPv4 节点）
  maybeAutoCorrectIp(nodeId, publicIp);

  // 持久化监控指标（节流：每 60 秒写一次库）
  const DB_WRITE_INTERVAL = 60_000;
  const lastWrite = agent._lastMetricsWrite || 0;
  if (Date.now() - lastWrite >= DB_WRITE_INTERVAL) {
    agent._lastMetricsWrite = Date.now();
    try {
      db.recordMetrics(nodeId, {
        cpuUsage: cpuUsage ?? null,
        memUsage: memUsage?.usagePercent ?? null,
        diskUsage: diskUsage?.usagePercent ?? null,
        loadAvg: loadAvg || [],
        netRxRate: netBandwidth?.rxRate ?? null,
        netTxRate: netBandwidth?.txRate ?? null,
        uptime: uptime ?? null,
      });
    } catch (err) {
      logger.debug({ err, nodeId }, '记录监控指标失败');
    }
  }

  // 处理滥用告警
  if (abuseAlerts && Array.isArray(abuseAlerts) && abuseAlerts.length > 0) {
    try {
      const node = db.getNodeById(nodeId);
      const nodeName = node ? node.name : `Node#${nodeId}`;
      for (const alert of abuseAlerts.slice(0, 10)) {
        // 写入数据库
        try {
          const d = db.getDb();
          d.prepare(`
            INSERT INTO abuse_log (node_id, user_id, alert_type, detail)
            VALUES (?, ?, ?, ?)
          `).run(
            nodeId,
            alert.userId || null,
            alert.type || 'unknown',
            JSON.stringify(alert)
          );
        } catch (dbErr) {
          logger.debug({ err: dbErr.message, nodeId, alert: alert.type }, '写入 abuse_log 失败');
        }
        // 发送通知（节流：同类告警 5 分钟内不重复通知）
        const throttleKey = `abuse_${nodeId}_${alert.type}_${alert.userId || 'all'}`;
        const now = Date.now();
        if (!handleReport._alertThrottle) handleReport._alertThrottle = {};
        if (!handleReport._alertThrottle[throttleKey] || now - handleReport._alertThrottle[throttleKey] > 300_000) {
          handleReport._alertThrottle[throttleKey] = now;
          try {
            const { notify } = require('./notify');
            notify.abuseAlert(nodeName, alert.type, alert);
          } catch (_) {}
        }
      }
      // 审计日志
      db.addAuditLog(null, 'abuse_alert', `节点 ${nodeName || nodeId} 上报 ${abuseAlerts.length} 条滥用告警`, 'agent');
    } catch (err) {
      logger.debug({ err: err.message, nodeId }, '处理滥用告警失败');
    }
  }
}

/**
 * 处理指令执行结果
 */
function handleCmdResult(ws, msg) {
  const { id, success, stdout, stderr, error, message: resultMsg, ...rest } = msg;
  const pending = pendingCommands.get(id);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingCommands.delete(id);

  if (success) {
    pending.resolve({ success: true, data: { stdout, stderr, message: resultMsg, ...rest } });
  } else {
    pending.resolve({ success: false, error: error || stderr || '执行失败' });
  }
}

/**
 * 处理 pong
 */
function handlePong(ws) {
  const { nodeId } = ws._agentState;
  const agent = agents.get(nodeId);
  if (agent) agent._pongReceived = true;
}

/**
 * 解析可用于某节点的活跃 agent 连接。
 * 同机多节点共用一个 agent 进程：若该节点自身无 ws，回退到同机 (同 ssh_host) 有活跃 ws 的 peer。
 * @returns {{agent, viaNodeId}|null}
 */
function resolveAgentForNode(nodeId) {
  const self = agents.get(nodeId);
  if (self && self.ws.readyState === 1) return { agent: self, viaNodeId: nodeId };
  try {
    const node = db.getNodeById(nodeId);
    const sshHost = node && (node.ssh_host || node.host);
    if (!sshHost) return null;
    for (const peer of db.getAllNodes()) {
      if (peer.id === nodeId) continue;
      if ((peer.ssh_host || peer.host) !== sshHost) continue;
      const a = agents.get(peer.id);
      if (a && a.ws.readyState === 1) return { agent: a, viaNodeId: peer.id };
    }
  } catch (err) {
    logger.debug({ err, nodeId }, 'resolveAgentForNode 查找 peer 失败');
  }
  return null;
}

/**
 * 向指定节点 agent 发送指令
 * @returns {Promise<{success, data?, error?}>}
 */
function sendCommand(nodeId, command) {
  return new Promise((resolve, reject) => {
    const resolved = resolveAgentForNode(nodeId);
    if (!resolved) {
      return resolve({ success: false, error: 'Agent 不在线' });
    }
    const agent = resolved.agent;

    const id = uuidv4();
    const payload = { ...command, id };

    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      resolve({ success: false, error: '指令超时' });
    }, CMD_TIMEOUT);

    pendingCommands.set(id, { resolve, reject, timer, nodeId });

    try {
      agent.ws.send(JSON.stringify(payload));
    } catch (err) {
      clearTimeout(timer);
      pendingCommands.delete(id);
      resolve({ success: false, error: err.message });
    }
  });
}

/**
 * 获取所有在线 agent 信息
 */
function getConnectedAgents() {
  const result = [];
  for (const [nodeId, agent] of agents) {
    if (agent.ws.readyState !== 1) continue;
    result.push({
      nodeId,
      nodeName: agent.nodeName,
      ip: agent.ip,
      connectedAt: agent.connectedAt,
      lastReport: agent.lastReport,
      reportData: agent.reportData,
      version: agent.version || null,
      capabilities: agent.capabilities || null,
      reconnectMetrics: agent.reconnectMetrics || { ...getOrCreateMetrics(nodeId) },
    });
  }
  return result;
}

/**
 * 检查指定节点是否有 agent 在线
 */
function isAgentOnline(nodeId) {
  return resolveAgentForNode(nodeId) !== null;
}

/**
 * 获取指定节点 agent 的最新上报数据
 */
function getAgentReport(nodeId) {
  const resolved = resolveAgentForNode(nodeId);
  return resolved ? resolved.agent.reportData : null;
}

/**
 * 关闭 WebSocket 服务
 */
function shutdown() {
  if (pingTimer) clearInterval(pingTimer);
  if (metricsCleanupTimer) clearInterval(metricsCleanupTimer);
  for (const [, agent] of agents) {
    try { agent.ws.close(1001, '服务关闭'); } catch (err) {
      logger.debug({ err, nodeId: agent.nodeId }, '关闭 Agent WebSocket 失败，已忽略');
    }
  }
  agents.clear();
  for (const [, pending] of pendingCommands) {
    clearTimeout(pending.timer);
    try { pending.resolve({ success: false, error: '服务关闭' }); } catch (err) {
      logger.debug({ err, nodeId: pending.nodeId }, '回调 pending 指令失败，已忽略');
    }
  }
  pendingCommands.clear();
  if (wss) wss.close();
}

module.exports = {
  init,
  sendCommand,
  getConnectedAgents,
  isAgentOnline,
  getAgentReport,
  shutdown,
};
