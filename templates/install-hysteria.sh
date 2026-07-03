set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

retry() {
  local max="$1"
  shift
  local i=1
  while true; do
    if "$@"; then
      return 0
    fi
    if [ "$i" -ge "$max" ]; then
      return 1
    fi
    i=$((i + 1))
    sleep 2
  done
}

retry 3 apt-get update -y
retry 3 apt-get install -y curl openssl

# 安装 hysteria
if ! command -v hysteria &> /dev/null; then
  install_script="$(mktemp)"
  curl -fsSL --retry 3 --retry-delay 2 https://get.hy2.sh/ -o "$install_script"
  bash "$install_script"
  rm -f "$install_script"
fi

command -v hysteria >/dev/null 2>&1 || { echo "install-hysteria: hysteria binary missing after install" >&2; exit 1; }

# 生成自签证书（10年有效期）
mkdir -p /etc/hysteria
if [ ! -f /etc/hysteria/cert.pem ]; then
  openssl ecparam -genkey -name prime256v1 -out /etc/hysteria/key.pem 2>/dev/null
  openssl req -new -x509 -days 3650 -key /etc/hysteria/key.pem -out /etc/hysteria/cert.pem -subj "/CN=bing.com" 2>/dev/null
fi
# 确保 hysteria 用户可读证书（官方安装器以 hysteria 用户运行）
chown root:root /etc/hysteria/key.pem /etc/hysteria/cert.pem
chmod 644 /etc/hysteria/cert.pem
chmod 644 /etc/hysteria/key.pem

# 覆盖 systemd service（官方安装器自带的以 hysteria 用户运行，我们统一用 root）
cat > /etc/systemd/system/hysteria-server.service << 'SERVICEEOF'
[Unit]
Description=Hysteria 2 Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server -c /etc/hysteria/config.yaml
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
SERVICEEOF
systemctl daemon-reload

echo "HY2_INSTALL_OK"
