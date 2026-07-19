# Node Agent (被控节点长连接代理)

`node-agent` 是安装在远程节点 VPS 上的轻量级 Node.js 客户端程序。它通过 WebSocket 协议与主面板建立安全的双向通信长连接，负责接收面板下发的部署指令、配置更新，并实时上报节点服务存活状态、系统资源用量与用户流量明细。

---

## 🚀 安装部署

### 1. 自动化安装（推荐）

在面板管理后台添加或部署节点时，主面板会自动通过 SSH 连接远程服务器并执行 `node-agent/install.sh` 完成安装。

### 2. 手动安装说明

如需在节点服务器上手动安装 Agent：

```bash
cd /root/panel/node-agent
./install.sh <server_url> <token> <node_id> [--check-ipv6]
```

**命令参数说明**：
- `server_url`：面板的 WebSocket 监听 Endpoint（例: `wss://panel.yourdomain.com/ws/agent`）。
- `token`：节点专属授权凭证（在面板节点详情或数据库 `nodes.agent_token` 中获取）。
- `node_id`：节点在面板数据库中的数字 ID（例: `311`）。
- `--check-ipv6` *(可选)*：自动优化 Linux 内核的 `accept_ra = 2` 参数，修复 IPv6 转发场景下的默认路由丢失问题。

---

## ⚙️ 配置文件结构

配置文件路径：`/etc/vless-agent/config.json` (权限 `0600`)

```json
{
  "server": "wss://panel.yourdomain.com/ws/agent",
  "token": "your-node-agent-token",
  "nodeId": 311,
  "checkIPv6": true
}
```

---

## ✨ 核心能力与功能

- **WebSocket 双向长连接**：支持断线自动指数退避重连与心跳保活。
- **多协议服务监控**：实时感知远程服务器上 Xray / Hysteria 2 进程的运行状态。
- **流量精确计费与上报**：按用户 UUID 采集流量增量数据并按周期上报主面板。
- **系统探针指标采集**：实时采集 CPU 占用、内存消耗、磁盘使用率、系统 Load 及网络带宽吞吐。
- **配置与服务远程控制**：支持远程向节点推送/更新配置，并执行 Xray 或 Hysteria 2 的平滑重启。
- **Agent 远程自更新**：主面板可安全地下发自更新指令，实现 Agent 程序的批量自动升级。

---

## 🛠️ 服务管理命令

`node-agent` 在节点服务器上被注册为 Systemd 守护进程 `vless-agent.service`：

```bash
# 查看 Agent 运行状态
systemctl status vless-agent

# 重启 Agent 服务
systemctl restart vless-agent

# 停止 Agent 服务
systemctl stop vless-agent

# 查看 Agent 实时运行日志
journalctl -u vless-agent -f -n 100
```
