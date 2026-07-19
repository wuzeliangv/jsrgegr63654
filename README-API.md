# API 规范与接口参考

本文档提供大姨子面板 (Dayizi Panel) 的全量 RESTful API 规范、鉴权机制及调试示例。

---

## 🔐 鉴权机制与统一约定

1. **用户会话 (`requireAuth`)**：标准 Express Session Cookie 认证，适用于用户面板页面。
2. **管理后台 API (`/admin/api/*`)**：需要管理员 Session + CSRF Header 防护。
3. **OPS 运维 API (`/ops/api/*`)**：请求头包含 `Authorization: Bearer <OPS_API_KEY>`，供外部自动化或 AI 巡检系统调用。
4. **统一响应结构**：
   - **成功**：`{ "ok": true, "data": ... }` 或包含请求的具体数据对象。
   - **错误**：`{ "error": "错误说明信息" }` 或 `{ "ok": false, "error": "错误说明信息" }`。

---

## 🏥 基础服务与健康检查

```http
GET /healthz
```
- **鉴权要求**：无（公开）
- **响应示例**：
  ```json
  {
    "status": "ok",
    "timestamp": "2026-07-19T22:40:00.000Z"
  }
  ```

---

## 🔑 身份认证 API (`/auth/*`)

| 请求方法 | 路由路径 | 说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/auth/login` | 获取登录页面 | 公开 |
| `POST` | `/auth/email-login` | 邮箱与密码登录 | 公开 |
| `GET` | `/auth/email-register` | 获取注册页面 | 公开 |
| `POST` | `/auth/email-register` | 邮箱注册提交 | 公开（需要验证码） |
| `POST` | `/auth/send-email-code` | 发送邮箱注册验证码 | 限流 |
| `GET` | `/auth/forgot-password` | 获取找回密码页面 | 公开 |
| `POST` | `/auth/forgot-send-code` | 发送重置密码验证码 | 限流 |
| `POST` | `/auth/forgot-reset` | 提交新密码重置 | 验证码校验 |
| `GET` | `/auth/temp-login` | 临时 Token 登录页面 | Token 校验 |
| `POST` | `/auth/generate-invite-code` | 生成邀请码 | 已登录用户 |
| `GET` | `/auth/logout` | 退出当前登录会话 | 已登录用户 |

---

## 📊 用户面板与探针 API

| 请求方法 | 路由路径 | 说明 | 鉴权要求 |
|---|---|---|---|
| `GET` | `/` | 用户面板首页 | 用户登录 |
| `GET` | `/api/panel-summary` | 获取配额、已用流量、节点及订阅状态 | 用户登录 |
| `POST` | `/api/tg-bind-token` | 生成 Telegram 绑定 Token | 用户登录 |
| `POST` | `/api/tg-unbind` | 解绑已关联的 Telegram 账号 | 用户登录 |
| `GET` | `/monitor` | 探针监控页面 | 用户登录 |
| `GET` | `/api/monitor/overview` | 获取所有节点 CPU/内存/带宽 实时指标 | 用户登录 |
| `GET` | `/api/monitor/node/:id` | 查询指定节点历史性能指标曲线 | 用户登录 |

---

## 📡 订阅分发 API

| 路由路径 | 协议与用途 |
|---|---|
| `GET /sub/:token` | VLESS 格式订阅 |
| `GET /sub6/:token` | VLESS (纯 IPv6) 格式订阅 |
| `GET /subhy2/:token` | Hysteria 2 格式订阅 |
| `GET /suball/:token` | 全协议混合订阅 |

- **智能 UA 转换**：自动检测 `User-Agent`，为 Clash 返回 YAML 配置，为 Sing-box 返回 JSON 配置，为通用客户端返回 Base64 文本。
- **签名校验**：当 `.env` 中配置 `SUB_LINK_SIGN_MODE=enforce` 时，请求必须携带有效的 `?sig=...` 签名参数。

---

## 🎮 Telegram WebApp 与游戏 API

| 请求方法 | 路由路径 | 功能说明 |
|---|---|---|
| `GET` | `/rps-game` | 猜拳游戏页面 |
| `POST` | `/api/rps-profile` / `/api/rps-play` | 猜拳战绩查询 / 提交出招 |
| `GET` | `/flip-game` | 翻卡抽奖页面 |
| `POST` | `/api/flip-profile` / `/api/flip-draw` | 翻卡档案查询 / 抽取奖励 |
| `GET` | `/lucky-wheel` | 幸运大转盘页面 |
| `POST` | `/api/lucky-profile` / `/api/lucky-spin` | 大转盘档案查询 / 执行抽奖 |

> **鉴权机制**：所有 WebApp API 均校验 Telegram 传入的 `initData` 签名与时效性。

---

## 🤖 OPS 运维 API (`/ops/api/*`)

请求头需携带 `Authorization: Bearer <OPS_API_KEY>`。

### 1. 数据查询接口

| 请求方法 | 路由路径 | 描述 |
|---|---|---|
| `GET` | `/ops/api/status` | 查询面板运行状态、版本与运行时数据 |
| `GET` | `/ops/api/nodes` | 获取所有节点配置及存活状态列表 |
| `GET` | `/ops/api/nodes/:id` | 查询单个节点的详细配置与度量数据 |
| `GET` | `/ops/api/users` | 获取用户列表、流量使用情况与状态 |
| `GET` | `/ops/api/audit-log` | 获取系统安全与操作审计日志 |
| `GET` | `/ops/api/health-summary` | 获取节点健康度统计摘要 |
| `GET` | `/ops/api/agents` | 查询所有 Agent WebSocket 长连接状态 |
| `GET` | `/ops/api/diary` | 查询 AI 运维日志记录 |

### 2. 自动化操作接口

| 请求方法 | 路由路径 | 功能说明 |
|---|---|---|
| `POST` | `/ops/api/nodes/:id/restart-xray` | 远程重启指定节点的 Xray / Hysteria 服务 |
| `POST` | `/ops/api/nodes/:id/swap-ip` | 触发该节点 AWS 自动更换公网 IP |
| `POST` | `/ops/api/nodes/:id/sync-config` | 强制向该节点重新推送并应用最新配置 |
| `POST` | `/ops/api/deploy` | 通过 API 自动化部署新节点 |
| `POST` | `/ops/api/rotate` | 执行全量/分组 UUID 及订阅 Token 安全轮换 |
| `POST` | `/ops/api/users/:id/freeze` | 冻结指定违规用户 |
| `POST` | `/ops/api/users/:id/unfreeze` | 解冻指定用户 |
| `POST` | `/ops/api/backup` | 立即触发数据库一键快照备份 |
| `POST` | `/ops/api/agents/update-all` | 批量向所有在线 Agent 下发自更新指令 |
| `POST` | `/ops/api/diary` | 写入巡检运维日志 |

---

## 🛠️ cURL 调试示例

```bash
# 1. 服务健康度检查
curl -i http://127.0.0.1:3000/healthz

# 2. 查询面板总体状态 (OPS API)
source /root/panel/.env
curl -s -H "Authorization: Bearer $OPS_API_KEY" http://127.0.0.1:3000/ops/api/status | jq .

# 3. 强制重启节点 311 上的代理内核
curl -s -X POST -H "Authorization: Bearer $OPS_API_KEY" \
  http://127.0.0.1:3000/ops/api/nodes/311/restart-xray | jq .

# 4. 写入一条巡检记录
curl -s -X POST -H "Authorization: Bearer $OPS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"category":"patrol","mood":"🍑","content":"例行自动化巡检完成，节点连通率 100%"}' \
  http://127.0.0.1:3000/ops/api/diary
```
