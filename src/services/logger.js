/**
 * 结构化日志模块 — 基于 pino
 * 替代 console.log/error，支持日志级别和 JSON 格式
 */
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) { return { level: label }; }
  }
});

module.exports = logger;
