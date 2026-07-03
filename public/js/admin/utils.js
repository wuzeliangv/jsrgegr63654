/* utils.js — 公共安全工具 */

/**
 * 浏览器端 HTML 特殊字符转义，防止 XSS 注入。
 * 服务端请使用 src/utils/escapeHtml.js，避免跨端直接复用。
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
