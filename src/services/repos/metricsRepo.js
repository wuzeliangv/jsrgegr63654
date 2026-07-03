let _getDb;

function init(deps) {
  _getDb = deps.getDb;
}

function recordMetrics(nodeId, data) {
  const stmt = _getDb().prepare(`
    INSERT INTO node_metrics (node_id, cpu_usage, mem_usage, disk_usage,
      load_avg_1, load_avg_5, load_avg_15,
      net_rx_rate, net_tx_rate, uptime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const loadAvg = data.loadAvg || [];
  stmt.run(
    nodeId,
    data.cpuUsage ?? null,
    data.memUsage ?? null,
    data.diskUsage ?? null,
    loadAvg[0] ?? null,
    loadAvg[1] ?? null,
    loadAvg[2] ?? null,
    data.netRxRate ?? null,
    data.netTxRate ?? null,
    data.uptime ?? null
  );
}

function getNodeMetrics(nodeId, sinceIso, untilIso, limit) {
  let sql = `SELECT * FROM node_metrics WHERE node_id = ?`;
  const params = [nodeId];
  if (sinceIso) {
    sql += ` AND recorded_at >= ?`;
    params.push(sinceIso);
  }
  if (untilIso) {
    sql += ` AND recorded_at <= ?`;
    params.push(untilIso);
  }
  sql += ` ORDER BY recorded_at ASC`;
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  return _getDb().prepare(sql).all(...params);
}

function getLatestMetricsAllNodes() {
  return _getDb().prepare(`
    SELECT m.* FROM node_metrics m
    INNER JOIN (
      SELECT node_id, MAX(recorded_at) AS max_time
      FROM node_metrics GROUP BY node_id
    ) latest ON m.node_id = latest.node_id AND m.recorded_at = latest.max_time
  `).all();
}

function cleanupMetrics(retentionDays) {
  const result = _getDb().prepare(
    `DELETE FROM node_metrics WHERE recorded_at < datetime('now', '-' || ? || ' days')`
  ).run(retentionDays);
  return { deletedMetrics: result.changes };
}

module.exports = {
  init,
  recordMetrics,
  getNodeMetrics,
  getLatestMetricsAllNodes,
  cleanupMetrics,
};
