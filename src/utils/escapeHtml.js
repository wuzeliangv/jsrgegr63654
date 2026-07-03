/**
 * 服务端 HTML 转义，防止 XSS 注入。
 * 仅用于 Node.js 侧（模板/接口）；浏览器侧请使用 public/js/admin/utils.js。
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

module.exports = { escapeHtml };
