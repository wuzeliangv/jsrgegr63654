#!/bin/bash
# ==============================================================================
# VLESS / Hy2 / SS Panel Node Agent 一键安装脚本
# 用法: ./install.sh <server_url> <token> <node_id> [--check-ipv6]
# 示例: ./install.sh wss://panel.example.com/ws/agent my-agent-token 101 --check-ipv6
# ==============================================================================

set -euo pipefail

if [ $# -lt 3 ]; then
  echo "用法: $0 <server_url> <token> <node_id> [--check-ipv6]"
  echo "示例: $0 wss://panel.example.com/ws/agent my-secret-token 123"
  echo "  选项 --check-ipv6: 开启 IPv6 连通性与 RA 路由转发修复 (适用于相关节点出站)"
  exit 1
fi

SERVER_URL="$1"
TOKEN="$2"
NODE_ID="$3"
CHECK_IPV6=false
if [ "${4:-}" = "--check-ipv6" ]; then
  CHECK_IPV6=true
fi

AGENT_DIR="/opt/vless-agent"
CONFIG_DIR="/etc/vless-agent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "┌──────────────────────────────────────────────────┐"
echo "│         VLESS / Hy2 Panel Node Agent 安装        │"
echo "└──────────────────────────────────────────────────┘"
echo "  中心地址: ${SERVER_URL}"
echo "  节点 ID : ${NODE_ID}"
echo ""

# 检查 root 权限
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ 请使用 root 权限运行此安装脚本"
  exit 1
fi

# 检查 Node.js 18+
if ! command -v node &>/dev/null; then
  echo "❌ 未检测到 Node.js 环境，请先安装 Node.js 18+"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "❌ 当前 Node.js 版本为 $(node -v)，必须 ≥ 18"
  exit 1
fi
echo "✓ Node.js 版本: $(node -v)"

# IPv6 路由与 RA 默认网关配置修复
if [ "$CHECK_IPV6" = "true" ]; then
  echo "正在应用 IPv6 转发模式下的 RA 路由规则..."
  cat > /etc/sysctl.d/99-ipv6-accept-ra.conf <<'SYSCTL_EOF'
# 修复 IPv6 转发模式下 Linux 忽略 RA 默认网关路由的问题
net.ipv6.conf.all.accept_ra = 2
net.ipv6.conf.default.accept_ra = 2
SYSCTL_EOF
  sysctl -p /etc/sysctl.d/99-ipv6-accept-ra.conf >/dev/null 2>&1 || true
  for iface in $(ls /sys/class/net | grep -E '^(eth|ens|enp|eth0)'); do
    sysctl -w net.ipv6.conf.${iface}.accept_ra=2 >/dev/null 2>&1 || true
  done
  echo "✓ IPv6 accept_ra 参数已优化为 2"
fi

# 安全创建配置文件
mkdir -p "$CONFIG_DIR"
node -e "
  var cfg = {
    server: process.argv[1],
    token: process.argv[2],
    nodeId: parseInt(process.argv[3], 10),
    checkIPv6: process.argv[4] === 'true'
  };
  require('fs').writeFileSync(process.argv[5], JSON.stringify(cfg, null, 2));
" "$SERVER_URL" "$TOKEN" "$NODE_ID" "$CHECK_IPV6" "${CONFIG_DIR}/config.json"
chmod 600 "${CONFIG_DIR}/config.json"
echo "✓ 配置文件写入成功: ${CONFIG_DIR}/config.json"

# 复制 Agent 程序
mkdir -p "$AGENT_DIR"
if [ ! -f "${SCRIPT_DIR}/agent.js" ]; then
  echo "❌ 缺少 agent.js 文件 (${SCRIPT_DIR}/agent.js)"
  exit 1
fi
cp "${SCRIPT_DIR}/agent.js" "${AGENT_DIR}/agent.js"
chmod 755 "${AGENT_DIR}/agent.js"
echo "✓ Agent 部署至: ${AGENT_DIR}/agent.js"

# 创建 systemd 守护服务
NODE_BIN_PATH="$(command -v node)"
cat > /etc/systemd/system/vless-agent.service <<EOF
[Unit]
Description=VLESS Panel Node Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${NODE_BIN_PATH} ${AGENT_DIR}/agent.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

# 系统隔离安全选项
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/vless-agent /etc/vless-agent /etc/hysteria /etc/xray /usr/local/etc/xray /tmp

StandardOutput=journal
StandardError=journal
SyslogIdentifier=vless-agent

[Install]
WantedBy=multi-user.target
EOF

echo "✓ systemd 服务 vless-agent.service 写入完成"

# 注册并启动
systemctl daemon-reload
systemctl enable vless-agent >/dev/null 2>&1 || true
systemctl restart vless-agent

echo "✓ 服务启动成功并已设为开机自启"
echo ""
echo "══════════════════════════════════════════════════"
echo " Agent 安装与初始化完毕"
echo "  - 查看服务状态: systemctl status vless-agent"
echo "  - 查看实时日志: journalctl -u vless-agent -f"
echo "══════════════════════════════════════════════════"
