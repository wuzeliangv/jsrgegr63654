#!/usr/bin/env bash
# ==============================================================================
# Xray 节点自动安装依赖与内核脚本 (由主面板/Agent 自动化调用)
# ==============================================================================

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

if ! command -v apt-get >/dev/null 2>&1; then
  echo "install-xray: unsupported OS (apt-get not found)" >&2
  exit 1
fi

# 轻量重试解决镜像暂锁或网络瞬断
retry 3 apt-get update -y
retry 3 apt-get install -y curl unzip jq ca-certificates

if ! command -v xray >/dev/null 2>&1; then
  install_script="$(mktemp)"
  curl -fsSL --retry 3 --retry-delay 2 \
    https://github.com/XTLS/Xray-install/raw/e741a4f56d368afbb9e5be3361b40c4552d3710d/install-release.sh \
    -o "$install_script"
  bash "$install_script" install
  rm -f "$install_script"
fi

command -v xray >/dev/null 2>&1 || { echo "install-xray: xray binary missing after install" >&2; exit 1; }
echo "INSTALL_OK"
