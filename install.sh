#!/bin/bash
# ══════════════════════════════════════════════════════════════
# 小姨子面板 (Dayizi Panel) 一键安装与配置脚本 v4.2
# 支持系统: Debian 11+ / Ubuntu 20.04+
# 用法: bash <(curl -sL https://raw.githubusercontent.com/vzzoxo/xiaoyizi/main/install.sh)
# ══════════════════════════════════════════════════════════════

set -eo pipefail

INSTALL_DIR="/root/panel"
REPO_URL="https://github.com/vzzoxo/xiaoyizi.git"
NODE_MAJOR=22

# ─── 颜色定义 ──────────────────────────────────────────────
if [ -t 1 ]; then
  R='\033[0;31m'
  G='\033[0;32m'
  Y='\033[1;33m'
  C='\033[0;36m'
  B='\033[1;37m'
  N='\033[0m'
else
  R=''; G=''; Y=''; C=''; B=''; N=''
fi

ok()   { echo -e "${G}[✓]${N} $1"; }
warn() { echo -e "${Y}[!]${N} $1"; }
err()  { echo -e "${R}[✗]${N} $1"; exit 1; }
info() { echo -e "${C}[i]${N} $1"; }

# ─── 错误捕获处理 ──────────────────────────────────────────
on_error() {
  local rc=$?
  local lineno=$1
  echo ""
  echo -e "${R}══════════════════════════════════════════════${N}"
  echo -e "${R}[✗] 安装过程意外中断，退出码 $rc，发生在脚本第 $lineno 行${N}"
  echo -e "${R}══════════════════════════════════════════════${N}"
  echo -e "${Y}排查与处理建议：${N}"
  echo -e "  1) 查看上方控制台输出的最后一条错误日志"
  echo -e "  2) 检查网络连通性：curl -I https://github.com （确认能否访问外网）"
  echo -e "  3) 手动运行软件源更新：apt update （排查源锁或镜像异常）"
  echo -e "  4) 修复网络或依赖后，重新运行本一键脚本不会破坏已有数据"
  exit $rc
}
trap 'on_error $LINENO' ERR

# ─── Banner 展示 ───────────────────────────────────────────
banner() {
  echo ""
  echo -e "${C}╔══════════════════════════════════════════════╗${N}"
  echo -e "${C}║${B}            🍑 小姨子 一键部署                ${C}║${N}"
  echo -e "${C}║${N}   多协议节点管理 · TG 互动 · AI 运维        ${C}║${N}"
  echo -e "${C}╚══════════════════════════════════════════════╝${N}"
  echo ""
}

# ─── 环境预检 ──────────────────────────────────────────────
preflight() {
  [ "$(id -u)" -ne 0 ] && err "请使用 root 用户运行本安装脚本"
  command -v apt &>/dev/null || err "当前系统不支持 apt，仅支持 Debian / Ubuntu 系统"

  local os ver
  os=$(. /etc/os-release && echo "$ID")
  ver=$(. /etc/os-release && echo "$VERSION_ID")
  info "操作系统: ${os} ${ver} ($(uname -m))"

  local mem_mb; mem_mb=$(free -m | awk '/^Mem:/{print $2}')
  info "系统内存: ${mem_mb} MB"
  [ "$mem_mb" -lt 256 ] && warn "内存容量较低，建议 ≥ 512 MB"

  if [ "$mem_mb" -lt 1024 ]; then
    local swap_mb; swap_mb=$(free -m | awk '/^Swap:/{print $2}')
    if [ "${swap_mb:-0}" -lt 512 ]; then
      warn "内存 ${mem_mb} MB + Swap ${swap_mb:-0} MB 偏低，编译/安装依赖可能遇到 OOM"
      warn "建议先执行 swap 增加命令："
      warn "  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
    fi
  fi
}

# ─── 安装系统依赖 ──────────────────────────────────────────
install_deps() {
  ok "更新软件包索引..."
  apt update -qq

  local pkgs=(curl git nginx certbot python3-certbot-nginx build-essential)
  local need=()
  for p in "${pkgs[@]}"; do
    dpkg -s "$p" &>/dev/null || need+=("$p")
  done
  if [ ${#need[@]} -gt 0 ]; then
    ok "正在安装基础依赖: ${need[*]} ..."
    DEBIAN_FRONTEND=noninteractive apt install -y -qq "${need[@]}"
  else
    ok "基础系统依赖已准备完毕"
  fi
}

# ─── 安装 Node.js ──────────────────────────────────────────
install_node() {
  local cur=0
  command -v node &>/dev/null && cur=$(node -v | cut -d. -f1 | tr -d v)
  if [ "$cur" -ge 20 ]; then
    ok "已检测到 Node.js $(node -v) ✓"
    return
  fi
  ok "正在安装 Node.js ${NODE_MAJOR}.x..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt install -y -qq nodejs
  ok "Node.js $(node -v) 安装成功 ✓"
}

# ─── 安装 PM2 ──────────────────────────────────────────────
install_pm2() {
  if command -v pm2 &>/dev/null; then
    ok "已检测到 PM2 $(pm2 -v) ✓"
    return
  fi
  ok "正在全局安装 PM2 进程管理器..."
  npm install -g pm2 --silent
  ok "PM2 安装完成 ✓"
}

# ─── 拉取与部署面板代码 ────────────────────────────────────
deploy_code() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    ok "发现已有代码目录，正在拉取最新版本..."
    cd "$INSTALL_DIR"
    git fetch origin main --quiet && git reset --hard origin/main --quiet
  else
    ok "正在克隆代码仓库..."
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" --quiet
    cd "$INSTALL_DIR"
  fi

  ok "正在安装项目生产依赖包..."
  npm install --omit=dev --no-audit --no-fund --silent
  mkdir -p data/logs backups
  chmod 700 backups || true
  ok "面板核心代码部署成功 ✓"
}

# ─── 配置环境变量 .env ─────────────────────────────────────
configure_env() {
  cd "$INSTALL_DIR"

  ensure_key() {
    local key="$1" value="$2"
    grep -q "^${key}=" .env 2>/dev/null || echo "${key}=${value}" >> .env
  }

  if [ -f .env ]; then
    DOMAIN=$(grep "^PANEL_DOMAIN=" .env 2>/dev/null | cut -d= -f2)
    ok "检测到已有 .env 配置 (域名: ${DOMAIN:-未设置})"
    ensure_key "OPS_API_KEY" "$(openssl rand -hex 32)"
    ensure_key "SESSION_SECRET" "$(openssl rand -hex 32)"
    ensure_key "PORT" "3000"
    ensure_key "NODE_ENV" "production"
    ensure_key "TZ" "Asia/Shanghai"
    ensure_key "LOG_LEVEL" "info"
    ensure_key "TRUST_PROXY" "1"
    ensure_key "SUB_LINK_SIGN_MODE" "off"
    return
  fi

  echo ""
  echo -e "${C}━━━ 面板交互式初始化配置 ━━━${N}"
  echo ""

  while true; do
    read -rp "$(echo -e "${C}请输入面板绑定的域名${N} (例: panel.yourdomain.com): ")" DOMAIN
    [ -n "$DOMAIN" ] && break
    warn "域名不能为空，请重新输入！"
  done

  read -rp "$(echo -e "${C}请输入 TG Bot Token${N} (可选，直接回车跳过): ")" TG_TOKEN

  cat > .env << EOF
PANEL_DOMAIN=${DOMAIN}
PORT=3000
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
SESSION_SECRET=$(openssl rand -hex 32)
TRUST_PROXY=1
OPS_API_KEY=$(openssl rand -hex 32)
SUB_LINK_SIGN_MODE=off
EOF

  [ -n "$TG_TOKEN" ] && echo "TG_BOT_TOKEN=${TG_TOKEN}" >> .env

  ok ".env 配置文件生成成功 ✓"
}

# ─── Nginx 与 Let's Encrypt SSL 申请 ───────────────────────
setup_ssl() {
  if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    ok "发现现有 SSL 证书，跳过申请"
    return 0
  fi

  ok "正在申请 Let's Encrypt 免费 SSL 证书..."
  cat > /etc/nginx/sites-available/vless-panel << EOF
server { listen 80; server_name ${DOMAIN}; location /.well-known/acme-challenge/ { root /var/www/html; } }
EOF
  ln -sf /etc/nginx/sites-available/vless-panel /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t &>/dev/null && systemctl reload nginx

  if certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null; then
    ok "SSL 证书申请成功 ✓"
    return 0
  fi

  warn "SSL 证书申请失败，请确认域名 DNS 已正确解析至本机 IP 且 80 端口放行。"
  read -rp "是否跳过 SSL 配置继续完成安装? (y/N): " ans
  [[ "$ans" =~ ^[yY]$ ]] || exit 1
  return 1
}

setup_nginx() {
  ok "正在配置 Nginx 反向代理服务..."

  cat > /etc/nginx/sites-available/vless-panel << 'NGINXEOF'
server {
    listen 80;
    server_name DOMAIN_PH;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name DOMAIN_PH;

    ssl_certificate     /etc/letsencrypt/live/DOMAIN_PH/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PH/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    add_header X-Frame-Options       "DENY"    always;
    add_header X-Content-Type-Options "nosniff" always;
    client_max_body_size 10m;

    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 86400;
    }
}
NGINXEOF

  sed -i "s/DOMAIN_PH/${DOMAIN}/g" /etc/nginx/sites-available/vless-panel
  ln -sf /etc/nginx/sites-available/vless-panel /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t &>/dev/null && systemctl reload nginx
  ok "Nginx 规则部署完成 ✓"
}

# ─── PM2 启动服务 ──────────────────────────────────────────
setup_pm2() {
  cd "$INSTALL_DIR"

  if pm2 list 2>/dev/null | grep -q dayizi-panel; then
    pm2 restart dayizi-panel --silent
  elif pm2 list 2>/dev/null | grep -q vless-panel; then
    pm2 restart vless-panel --silent
  else
    pm2 start ecosystem.config.js --silent
  fi
  pm2 save --silent 2>/dev/null
  pm2 startup systemd -u root --hp /root 2>/dev/null || true

  sleep 3
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/healthz 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    ok "面板后台已成功启动运行 ✓"
  else
    warn "面板服务还在拉起中 (HTTP status: ${code})，可稍后运行命令查看状态: pm2 status"
  fi
}

# ─── 安装 OpenClaw 运维 (可选) ─────────────────────────────
setup_openclaw() {
  echo ""
  read -rp "$(echo -e "${C}是否可选安装 OpenClaw AI 运维拓展?${N} (y/N): ")" ans
  [[ "$ans" =~ ^[yY]$ ]] || return

  set +e
  if ! command -v openclaw &>/dev/null; then
    ok "正在全局安装 OpenClaw CLI..."
    npm install -g openclaw --silent
    if ! command -v openclaw &>/dev/null; then
      warn "OpenClaw 安装跳过（非致命组件）"
      set -e
      return 0
    fi
  fi

  if [ -f "$INSTALL_DIR/openclaw-ops/setup.sh" ]; then
    if ! bash "$INSTALL_DIR/openclaw-ops/setup.sh" --force; then
      warn "OpenClaw 初始化跳过，稍后可手动执行: bash $INSTALL_DIR/openclaw-ops/setup.sh --force"
    fi
  fi
  set -e

  echo ""
  info "OpenClaw 推荐启用命令："
  info "  1. openclaw gateway start"
  info "  2. openclaw system heartbeat enable"
}

# ─── 部署总结 ──────────────────────────────────────────────
show_result() {
  local ver; ver=$(node -e "console.log(require('${INSTALL_DIR}/package.json').version)" 2>/dev/null || echo "4.1.1")
  echo ""
  echo -e "${G}╔══════════════════════════════════════════════╗${N}"
  echo -e "${G}║${B}       🍑 部署完成 — v${ver}                    ${G}║${N}"
  echo -e "${G}╚══════════════════════════════════════════════╝${N}"
  echo ""
  echo -e "  🌐 用户面板:  ${C}https://${DOMAIN}${N}"
  echo -e "  🔧 管理后台:  ${C}https://${DOMAIN}/admin${N}"
  echo -e "  📁 安装路径:  ${INSTALL_DIR}"
  echo ""
  echo -e "  ${Y}📌 提示 1: 系统的首个注册用户将自动升级为管理员身份${N}"
  echo -e "  ${Y}📌 提示 2: 管理员登录后请先在设置中配置 SMTP 邮箱服务${N}"
  echo ""
  echo -e "  常用服务控制命令:"
  echo -e "    pm2 logs dayizi-panel       ${C}# 查看面板日志${N}"
  echo -e "    pm2 restart dayizi-panel    ${C}# 重启面板服务${N}"
  echo -e "    cd ${INSTALL_DIR} && git pull && npm i --omit=dev && pm2 restart dayizi-panel  ${C}# 更新版本${N}"
  echo ""
}

# ─── 主入口 ────────────────────────────────────────────────
main() {
  banner
  preflight
  install_deps
  install_node
  install_pm2
  deploy_code
  configure_env
  setup_ssl && setup_nginx
  setup_pm2
  setup_openclaw
  show_result
}

main "$@"
