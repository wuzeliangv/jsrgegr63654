# 大姨子的诱惑 (Dayizi Panel)

> 一款专为个人与小型团队设计的极简、高效、现代化的多协议代理节点管理与订阅分发面板。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-lightgrey.svg)](https://expressjs.com)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-blue)](https://www.sqlite.org)

基于 **Node.js 22 + Express 5 + SQLite (WAL模式)** 打造，将用户管理、节点编排、智能订阅、流量统计及 AI 自动化运维无缝集成至同一系统。全面支持 **VLESS Reality**、**Shadowsocks** 和 **Hysteria 2** 三大主流代理协议。

---

## ✨ 核心特性

### 🌐 多协议与智能订阅
- **多协议支持**：原生支持 VLESS Reality（TCP/WS）、Shadowsocks（AES-GCM/2022）以及 Hysteria 2。
- **智能 UA 识别**：根据客户端（Clash / Sing-box / V2Ray / Shadowrocket / Quantumult X 等）自动下发适配格式。
- **防盗链与限流**：支持 HMAC 订阅签名（`off` / `observe` / `enforce`）、IP 限流与 Token 刷新。

### 👥 用户与流量管理
- **灵活分组**：支持自定义用户组（家宽组、SVIP、SSVIP 等），可分别配置流量限额与到期时间。
- **精确计费**：基于 WebSocket / gRPC / Stats 实时上报上行与下行流量，提供 7 天趋势图与来源分析。
- **自动化冻结**：支持超量冻结、到期冻结以及不活跃用户自动冻结。

### ☁️ 云平台编排与自动换 IP
- **AWS 原生集成**：集成 AWS EC2 与 Lightsail 多账号管理，支持一键创建实例与销毁。
- **被墙自动感知**：定时检测节点 TCP/UDP 连通性，自动识别 IP 被封禁并自动触发换 IP 及配置同步。
- **SOCKS5 落地转发**：支持为节点挂载外部/本地 SOCKS5 落地出口（如搭配分布式 NodePool 节点池使用）。

### 🤖 Telegram Bot 互动
- **每日签到**：签到领取随机流量，支持连续签到自动提升用户组等级。
- **小游戏互动**：内置幸运大转盘、每日翻卡、石头剪刀布等娱乐功能。
- **运维通知**：节点离线/恢复/被墙通知、用户超速/超量告警、定时备份提醒。

### 🛠️ 运维与安全
- **OPS API**：提供 RESTful 管理接口，方便集成外部巡检或 AI 运维脚本。
- **实时探针**：CPU、内存、磁盘、带宽用量及网络延迟实时展现。
- **安全防护**：Helmet 头防护、CSP 策略、CSRF 校验、scrypt 密码哈希、AES-256-GCM 凭据加密。

---

## 🚀 快速部署

### 一键脚本部署（推荐）

适用于 Debian 11+ / Ubuntu 20.04+ 系统：

```bash
bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/xiaoyizi/main/install.sh)
```

脚本将自动配置：基础依赖 ➔ Node.js 22 ➔ PM2 进程管理 ➔ 环境配置文件 `.env` ➔ Nginx 反向代理与 Let's Encrypt SSL 证书。

> **提示**：系统注册的首个用户会自动获得超级管理员权限。

### 手动构建部署

```bash
# 1. 克隆代码仓库
git clone https://github.com/vzzoxo/xiaoyizi.git /root/panel
cd /root/panel

# 2. 安装生产依赖
npm install --omit=dev

# 3. 配置文件初始化
cp .env.example .env
# 编辑 .env 配置 PANEL_DOMAIN 与 SESSION_SECRET

# 4. 启动服务
pm2 start ecosystem.config.js
```

---

## ⚙️ 环境变量配置

`.env` 配置文件核心参数说明：

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `PANEL_DOMAIN` | ✅ | - | 面板访问域名（用于 CSRF 校验及订阅链接生成） |
| `SESSION_SECRET` | ✅ | - | 会话加密密钥（建议使用 `openssl rand -hex 32` 生成） |
| `PORT` | ❌ | `3000` | 后端服务监听端口 |
| `NODE_ENV` | ❌ | `production` | 运行环境模式 |
| `TG_BOT_TOKEN` | ❌ | - | Telegram Bot Token（留空则不开启 TG 机器人） |
| `OPS_API_KEY` | ❌ | - | OPS 运维 API 鉴权 Token |
| `SUB_LINK_SIGN_MODE` | ❌ | `off` | 订阅链接防盗链签名模式 (`off` / `observe` / `enforce`) |
| `TRUST_PROXY` | ❌ | `1` | Nginx/Cloudflare 反向代理信任层数 |

---

## 📁 项目目录结构

```
/root/panel/
├── src/
│   ├── app.js                  # 应用主入口 (Express 服务启动、Session、中间件注册)
│   ├── routes/                 # 路由层 (用户面板、管理后台、订阅分发、OPS API)
│   ├── services/               # 业务逻辑服务 (数据库、节点部署、AWS 管理、TG 机器人)
│   ├── middleware/             # 中间件 (鉴权、CSRF 防护、速率限制、错误捕捉)
│   └── utils/                  # 工具函数 (加解密、密码哈希、时间格式化等)
├── views/                      # EJS 前端页面模板
├── public/                     # 静态资源文件 (CSS、JavaScript、图片)
├── node-agent/                 # 远程节点 Agent 通信代理程序
├── templates/                  # 远程节点协议安装模板脚本 (Xray / Hysteria 2)
├── container-core/             # 轻量级 VLESS-over-WS 入站转发核心
├── install.sh                  # 主面板一键部署脚本
└── ecosystem.config.js         # PM2 进程配置文件
```

---

## 📖 关联文档

- 📘 [管理后台使用指南](./ADMIN-GUIDE.md) — 各模块配置与运维操作
- 🔌 [OPS & API 接口参考](./README-API.md) — 自动化运维与 REST 接口规范
- 📋 [上线部署检查清单](./DEPLOY-CHECKLIST.md) — 生产环境安全与准备事项
- 📝 [版本更新日志](./CHANGELOG.md) — 历史版本变动记录
- 📡 [Node Agent 说明](./node-agent/README.md) — 被控节点代理程序配置
- 🐳 [Container Core 说明](./container-core/README.md) — 容器化无 Xray 节点核心说明

---

## 📜 许可证

本项目采用 [MIT License](./LICENSE) 开源协议。
