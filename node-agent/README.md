# Node Agent

节点 Agent 通过 WebSocket 与面板保持长连接，负责状态上报、配置同步和服务控制。

## 安装

通常由面板部署节点时自动安装。手动安装：

```bash
./install.sh <server_url> <token> <node_id> [--check-ipv6]
```

示例：

```bash
./install.sh wss://panel.example.com/ws/agent your-agent-token 123
```

## 配置

路径：`/etc/vless-agent/config.json`

```json
{
  "server": "wss://panel.example.com/ws/agent",
  "token": "your-node-agent-token",
  "nodeId": 1,
  "checkIPv6": false
}
```

## 能力

- WebSocket 心跳保活
- Xray / Hysteria 2 存活检测
- 流量记录上报
- 资源用量上报（CPU / 内存 / 磁盘 / 负载）
- 远程重启 Xray / Hysteria 2
- 远程更新配置
- Agent 自更新
- 白名单命令执行

## 管理

```bash
systemctl status vless-agent
systemctl restart vless-agent
journalctl -u vless-agent -f
```

## 注意

- 面板域名变更后需同步更新 Agent 的 `server` 配置
- `exec` 命令走白名单限制
