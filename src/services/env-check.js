/**
 * 启动时 .env 环境变量校验
 * - PANEL_DOMAIN 自动派生 AGENT_WS_URL
 * - 缺少必要变量时明确报错并退出
 */
const logger = require('./logger');

const REQUIRED_VARS = [
  'SESSION_SECRET',
];

/**
 * 从 PANEL_DOMAIN 自动派生域名相关变量
 * 如果已手动设置则不覆盖
 */
function deriveDomainVars() {
  const domain = process.env.PANEL_DOMAIN;
  if (!domain) return;

  if (!process.env.AGENT_WS_URL) {
    process.env.AGENT_WS_URL = `wss://${domain}/ws/agent`;
    logger.info({ domain }, 'AGENT_WS_URL 已从 PANEL_DOMAIN 自动派生');
  }
}

function validateEnv() {
  // 先从 PANEL_DOMAIN 派生
  deriveDomainVars();

  const missing = REQUIRED_VARS.filter(v => !process.env[v]);
  if (missing.length > 0) {
    logger.fatal({ missing }, '缺少必要环境变量，请检查 .env 文件');
    process.exit(1);
  }
  // 警告 SESSION_SECRET 使用默认值或太短
  const secret = process.env.SESSION_SECRET || '';
  if (secret === 'dev-secret-change-me' || secret === 'change-me-to-random-string' || secret === 'change-me-to-a-random-64-char-string') {
    logger.fatal('SESSION_SECRET 使用了示例默认值，请生成强随机密钥（建议 openssl rand -hex 32）');
    if (process.env.NODE_ENV === 'production') process.exit(1);
  }
  if (secret.length < 32) {
    logger.warn({ length: secret.length }, 'SESSION_SECRET 长度小于 32 字符，建议至少 32 位（建议 openssl rand -hex 32）');
  }
  // OPS_API_KEY 配置时校验长度（不强制要求设置）
  const opsKey = process.env.OPS_API_KEY || '';
  if (opsKey && opsKey.length < 32) {
    logger.warn({ length: opsKey.length }, 'OPS_API_KEY 长度小于 32 字符（建议至少 32 位，可用 openssl rand -hex 32 生成）');
  }
}

module.exports = { validateEnv };
