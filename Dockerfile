# ==============================================================================
# dayizi-panel —— Northflank / 通用容器镜像
# 多阶段构建：builder 编译 better-sqlite3 原生模块，runtime 只带运行时产物
# ==============================================================================

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder

# better-sqlite3 是原生模块，需要编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先只拷贝依赖清单，最大化利用构建缓存
COPY package.json package-lock.json ./

# 仅装生产依赖（Tailwind 等 devDependencies 不需要，CSS 已预编译入仓库）
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    TZ=Asia/Shanghai

WORKDIR /app

# 复制已编译好的依赖（与 runtime 同为 bookworm-slim，ABI 兼容）
COPY --from=builder /app/node_modules ./node_modules

# 复制应用代码（.dockerignore 已排除 data/、backups/、.env、node_modules 等）
COPY . .

# 数据目录：必须挂 Northflank 持久卷到这里，否则重启丢库
RUN mkdir -p /app/data /app/data/logs \
    && chown -R node:node /app

USER node

EXPOSE 8080

# 容器级健康检查（Northflank 也可单独配置 HTTP 健康检查指向 /healthz）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Northflank 由平台负责重启，直接前台跑 node，不用 PM2
CMD ["node", "src/app.js"]
