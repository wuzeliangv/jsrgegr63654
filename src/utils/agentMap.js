/**
 * 构建 peer-aware agentMap：同机双协议节点共享 Agent 在线状态
 * @param {Array} agents - agentWs.getConnectedAgents() 结果
 * @param {Array} nodes - db.getAllNodes() 结果
 * @returns {Map} nodeId → agent
 */
function buildAgentMap(agents, nodes) {
  const agentMap = new Map(agents.map(a => [a.nodeId, a]));
  const hostGroups = new Map();
  for (const n of nodes) {
    const host = (n.ssh_host || n.host || '').trim();
    if (!host) continue;
    if (!hostGroups.has(host)) hostGroups.set(host, []);
    hostGroups.get(host).push(n.id);
  }
  for (const group of hostGroups.values()) {
    if (group.length < 2) continue;
    const connected = group.find(id => agentMap.has(id));
    if (!connected) continue;
    const agent = agentMap.get(connected);
    for (const id of group) {
      if (!agentMap.has(id)) agentMap.set(id, agent);
    }
  }
  return agentMap;
}

/**
 * 构建在线 Agent nodeId Set（含同机共享）
 * @param {Array} agents - agentWs.getConnectedAgents() 结果
 * @param {Array} nodes - db.getAllNodes() 结果
 * @returns {Set} 在线的 nodeId 集合
 */
function buildOnlineAgentSet(agents, nodes) {
  const onlineAgents = new Set(agents.map(a => a.nodeId));
  const onlineHosts = new Set();
  for (const n of nodes) {
    const host = (n.ssh_host || n.host || '').trim();
    if (host && onlineAgents.has(n.id)) onlineHosts.add(host);
  }
  for (const n of nodes) {
    const host = (n.ssh_host || n.host || '').trim();
    if (host && !onlineAgents.has(n.id) && onlineHosts.has(host)) {
      onlineAgents.add(n.id);
    }
  }
  return onlineAgents;
}

module.exports = { buildAgentMap, buildOnlineAgentSet };
