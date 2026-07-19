# Container Core (轻量化容器入站转发核心)

`container-core` 是一个基于 Go 语言编写的轻量级纯净入站转发核心，专为容器化环境（如 Northflank、Docker、Koyeb、Render 等 PaaS 平台）设计。它支持 **VLESS-over-WS** 协议，TLS 由前置 Pass 平台或 Nginx / Caddy 终止后，明文 WebSocket 反代至本进程。

`container-core` 完全独立运行，**不依赖 Xray 内核**。它独立解析 VLESS 报文、按用户 UUID 进行中继鉴权与流量记账，并复用大姨子面板标准的 `/ws/agent` WebSocket 协议上报存活状态与流量数据。

---

## 🏗️ 工作架构

```
[用户客户端] ─── TLS ───▶ [平台前置反代/Caddy] ─── 明文 WS ───▶ [container-core] ─── TCP ───▶ [目标网站/IP]
                                                                  │
                                                                  ├─ GET  /api/agent/users (同步节点有效用户表)
                                                                  └─ WS   /ws/agent        (周期上报存活与增量流量)
```

1. **入站鉴权**：解析 VLESS 报文头部的 UUID，校验是否存在于本地同步的用户表中；若非法则直接阻断。
2. **流量计量**：精确记录上行与下行字节数，按 `userId` 分组累加，并在上报周期（默认 5s）内作为增量（Delta）通过 WebSocket 发送给面板。
3. **状态上报**：在 WebSocket 上报中使用 `serviceAlive` 别名标识服务存活，源码零 Xray 依赖。

---

## ⚙️ 环境变量说明

| 环境变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PANEL_BASE` | ✅ | - | 面板基础 URL（例: `https://panel.yourdomain.com`） |
| `NODE_ID` | ✅ | - | 该节点在面板中对应的数字 ID |
| `AGENT_TOKEN` | ✅ | - | 节点的 `agent_token`（在面板节点详情或数据库中获取） |
| `WS_PATH` | ❌ | `/bing` | 入站 WebSocket 路径（**必须与面板节点设置的 `ws_path` 一致**） |
| `LISTEN` | ❌ | `:8080` | 容器内本地监听端口 |
| `USER_SYNC_INTERVAL` | ❌ | `60s` | 从面板同步有效用户列表的周期 |
| `REPORT_INTERVAL` | ❌ | `5s` | 向面板上报存活与流量增量的周期 |

---

## 🐳 Docker 构建与部署

```bash
# 1. 构建镜像
docker build -t container-core ./container-core

# 2. 启动容器
docker run -d --name container-core \
  -p 8080:8080 \
  -e PANEL_BASE=https://panel.yourdomain.com \
  -e NODE_ID=12 \
  -e AGENT_TOKEN=your-agent-token \
  -e WS_PATH=/ws \
  container-core
```

---

## 📋 面板侧配置步骤

1. 登录面板管理后台 ➔ **节点** ➔ 点击 **「➕ 手动添加节点」**。
2. 配置参数：
   - **协议**：`VLESS`
   - **传输协议**：`ws`
   - **安全类型**：`tls`
   - **连接地址**：容器前置平台的 TLS 域名
   - **端口**：平台对外端口（通常为 `443`）
   - **Path**：与容器中配置的 `WS_PATH` 完全一致（例: `/ws`）
3. 保存后在节点列表中获取该节点的 `NODE_ID` 与 `AGENT_TOKEN`，填入容器的环境变量中即可。

---

## 🏥 健康检查接口

```http
GET /healthz
```
返回 `{"status":"ok"}`，供容器平台配置 Liveness / Readiness 探针。
