# 大姨子的诱惑 (Dayizi Panel)

面向个人与小团队的高能多协议代理管理面板，将用户管理、节点编排、智能订阅、流量统计以及 AI 自动化运维无缝集成至同一系统。

## 🌟 核心特性

- **多协议支持**：支持 VLESS Reality (TCP/WS)、Shadowsocks 以及 Hysteria 2。
- **用户与配额**：邮箱注册登录，支持用户分组、流量配额限制、过期与不活跃自动冻结。
- **智能订阅分发**：自动识别客户端 UA（Clash / Sing-box / V2Ray / Shadowrocket 等），下发适配配置。
- **节点自动部署**：一键部署远程 VPS，支持挂载 SOCKS5 落地出口与 AWS 集成自动换 IP。
- **Telegram Bot 互动**：支持每日签到领流量、幸运大转盘、翻卡、猜拳游戏及节点状态通知。
- **探针与运维**：实时监控服务器 CPU/内存/带宽/延迟，提供 OPS API 与数据库一键备份恢复。

## 🚀 一键安装

适用于 Debian 11+ / Ubuntu 20.04+ 系统：

```bash
bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/xiaoyizi/main/install.sh)
```

## 📚 延伸文档

- 📖 [完整项目说明](./README.md)
- 📘 [管理后台指南](./ADMIN-GUIDE.md)
- 🔌 [API 接口参考](./README-API.md)
- 📋 [上线检查清单](./DEPLOY-CHECKLIST.md)

## 📜 开源协议

[MIT License](./LICENSE)
