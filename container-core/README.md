# node-core

容器内自研入站 core,与面板(dayizi-panel)对接。**VLESS over WS**,TLS 由前置平台
(如 Northflank / Nginx / Caddy)终止后反代到本进程的明文 WS 端口。

不依赖 Xray:自己解析 VLESS、按用户中继、按 `userId` 计流量,并通过面板既有的
`/ws/agent` 协议上报(节点上线 + 按用户流量记账复用面板全部逻辑)。

## 工作方式

```
用户客户端 ──TLS──▶ 平台反代 ──ws(明文)──▶ node-core ──TCP──▶ 目标
                                              │
                                              ├─ GET  /api/agent/users   拉本节点用户表(uuid→userId)
                                              └─ WS   /ws/agent           周期上报存活 + 按用户流量增量
```

- **入站鉴权**:VLESS 头里的 UUID 必须在已同步的用户表中,否则直接断开。
- **计量**:上行 = 客户端→目标字节,下行 = 目标→客户端字节,按 `userId` 累计,
  每个上报周期作为增量(delta)发给面板。
- **存活字段**:上报用中性的 `serviceAlive`(面板已支持该别名),源码不含任何 `xray` 字样。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `PANEL_BASE` | | `https://cd.sd` | 面板地址,如 `https://panel.example.com` |
| `NODE_ID` | ✅ | — | 该节点在面板中的 id |
| `AGENT_TOKEN` | ✅ | — | 该节点的 `agent_token`(面板节点详情/数据库中获取) |
| `WS_PATH` | | `/bing` | 入站 WS 路径,**必须与面板节点的 `ws_path` 一致** |
| `LISTEN` | | `:8080` | 监听地址 |
| `USER_SYNC_INTERVAL` | | `60s` | 用户表同步间隔 |
| `REPORT_INTERVAL` | | `5s` | 上报间隔 |

## 构建与运行

```bash
docker build -t node-core ./container-core
docker run -d --name node-core -p 8080:8080 \
  -e PANEL_BASE=https://panel.example.com \
  -e NODE_ID=12 \
  -e AGENT_TOKEN=<节点 agent_token> \
  -e WS_PATH=/ws \
  node-core
```

平台侧:把公网 TLS 域名反代到容器的 `8080`,WebSocket 升级放行。

## 面板侧配置(一次性)

后台 → 节点 →「➕ 手动添加节点」:
- 协议 `VLESS`、传输 `ws`、安全 `tls`
- 连接地址 = 你的 TLS 域名,端口 = 平台对外端口(通常 443)
- **path = 与本程序 `WS_PATH` 完全一致**
- SNI/Host 默认同域名

添加后在节点详情拿到 `NODE_ID` 与 `AGENT_TOKEN` 填回容器环境变量即可。

## 健康检查

`GET /healthz` → `{"status":"ok"}`(供平台健康检查)。

## 已知限制(v1)

- **仅 TCP**:VLESS UDP(命令 2,如部分 QUIC/UDP DNS)暂未实现,后续可加。
- **重连丢量**:上报失败时该周期(默认 5s)的增量会丢失;间隔很短,影响极小。
- 不做出站分流/规则,统一直连目标。
- **探针指标**:CPU/内存/负载/磁盘/带宽来自 `/proc` 与 `statfs`;若容器内 `/proc` 反映宿主机
  (常见于共享内核 PaaS),CPU/内存可能偏向宿主机数值,仅供参考。
