const db = require('../services/database');
const logger = require('../services/logger');
const { appendSignature, getConfig: getSubSignConfig } = require('./subSignature');

const subSignConfig = getSubSignConfig();

function getUserNodeUuidMap(userId, nodes) {
  const map = new Map();
  const existing = db.getUserAllNodeUuids(userId);
  for (const row of existing) {
    if (row && row.node_id != null && row.uuid) {
      map.set(Number(row.node_id), row.uuid);
    }
  }
  for (const n of nodes) {
    if (!map.has(Number(n.id))) {
      const row = db.getUserNodeUuid(userId, n.id);
      if (row?.uuid) map.set(Number(n.id), row.uuid);
    }
  }
  return map;
}

function buildSubUrl(req, token, scope = 'sub') {
  const pathMap = { sub6: '/sub6/', subhy2: '/subhy2/', suball: '/suball/' };
  const path = (pathMap[scope] || '/sub/') + token;
  const base = `${req.protocol}://${req.get('host')}${path}`;
  return appendSignature(base, token, scope);
}

function readSubSignatureFromQuery(req) {
  const raw = req.query?.[subSignConfig.paramName];
  if (Array.isArray(raw)) return String(raw[0] || '');
  return String(raw || '');
}

function resolveSubUserIdByToken(token) {
  try {
    const user = db.getUserBySubToken(token);
    return user?.id || null;
  } catch (err) {
    logger.debug({ err, tokenPrefix: String(token || '').slice(0, 8) }, '解析订阅 token 对应用户失败，已忽略');
    return null;
  }
}

function logSubAccessEventSafe(input = {}) {
  try {
    db.logSubAccessEvent({
      userId: input.userId || null,
      tokenPrefix: String(input.token || '').slice(0, 8),
      route: input.route || 'sub',
      result: input.result || 'allow',
      reason: input.reason || 'ok',
      ip: input.ip || '',
      ua: input.ua || '',
      clientType: input.clientType || '',
      httpStatus: input.httpStatus || 200,
    });
  } catch (err) {
    logger.debug({
      err,
      route: input.route || 'sub',
      reason: input.reason || 'ok',
      tokenPrefix: String(input.token || '').slice(0, 8),
    }, '写入订阅访问事件失败，已忽略');
  }
}

function canUserAccessNode(user, node) {
  return (user.trust_level >= (node.min_level || 0));
}

module.exports = {
  getUserNodeUuidMap,
  buildSubUrl,
  readSubSignatureFromQuery,
  resolveSubUserIdByToken,
  logSubAccessEventSafe,
  canUserAccessNode,
};
