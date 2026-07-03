function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.max(0, Math.floor(Math.log(n) / Math.log(1024))), units.length - 1);
  return (n / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

module.exports = { formatBytes };
