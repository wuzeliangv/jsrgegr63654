# 🚀 上线与部署检查清单 (Deploy Checklist)

本检查清单适用于新安装部署、服务器迁移或重大版本升级后的全量自检与逐项确认。

---

## 1. 进程与服务运行状态

```bash
# 1. 确认 PM2 进程 online 状态
pm2 list

# 2. 检查本地健康检测接口
curl -s http://127.0.0.1:3000/healthz

# 3. 查看面板最新日志，确认无异常 Error 堆栈
pm2 logs dayizi-panel --lines 50 --nostream
```

---

## 2. 域名与 Nginx / HTTPS 证书

```bash
# 检查 Nginx 语法与服务状态
nginx -t && systemctl status nginx

# 检查 HTTPS 头部及证书有效期
curl -I https://你的面板域名
```
- [ ] Nginx 代理响应 `HTTP/2 200` 或 `301` 跳转正常。
- [ ] Let's Encrypt SSL 证书正常生效且无安全警告。

---

## 3. 环境变量配置 (`.env`)

打开 `/root/panel/.env` 文件确认：
- [ ] `PANEL_DOMAIN` 正确配置为当前访问域名。
- [ ] `SESSION_SECRET` 为足够强度的随机字符串。
- [ ] `OPS_API_KEY` 已生成并妥善保管。
- [ ] `TG_BOT_TOKEN`（若启用 Telegram 机器人）已填写。

---

## 4. 账号登录与后台功能

- [ ] 访问 `https://你的面板域名` 能够正常载入首页。
- [ ] 注册首个管理员账号，并确认能成功进入 `/admin` 管理后台。
- [ ] 在 `/admin` ➔ **设置** 模块配置 SMTP 邮件参数并发送测试邮件成功。

---

## 5. 节点编排与 Agent 通信

- [ ] 在管理后台创建并部署一个测试节点（VLESS / Hy2 / SS）。
- [ ] 查看节点 Agent 日志确认长连接在线：`journalctl -u vless-agent -f`
- [ ] 在管理后台触发一次「同步配置」或「重启服务」，确认节点同步正常。

---

## 6. 订阅链接与客户端适配

使用 cURL 模拟不同客户端 User-Agent 测试订阅接口：
```bash
# 测试 VLESS / Hy2 / 混合订阅
curl -s -A "Clash/1.0" "https://你的面板域名/suball/你的订阅Token"
curl -s -A "v2rayN/5.0" "https://你的面板域名/suball/你的订阅Token"
```
- [ ] 返回的内容格式符合对应客户端的解析规范（YAML / Base64）。

---

## 7. Telegram Bot & WebApp 游戏

- [ ] 在 Telegram 中向 Bot 发送 `/start` 并完成面板账号绑定。
- [ ] 测试 `/checkin`（每日签到）、`/me`（个人中心）、`/sub`（获取订阅）指令。
- [ ] 测试 WebApp 小游戏（翻卡、猜拳、大转盘）交互与流量奖励到账情况。

---

## 8. 自动化与快照备份

- [ ] 在 `/admin` ➔ **备份** 页面手动生成一次数据库备份快照，确认文件成功写入 `backups/` 目录。
- [ ] 测试 OPS API 鉴权：
  ```bash
  source /root/panel/.env
  curl -s -H "Authorization: Bearer $OPS_API_KEY" http://127.0.0.1:3000/ops/api/status
  ```
