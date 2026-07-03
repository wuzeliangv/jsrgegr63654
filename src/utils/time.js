function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseDateInput(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'string') {
    const s = input.trim();
    // UTC SQL datetime without timezone: YYYY-MM-DD HH:mm:ss
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const hour = Number(m[4] || 0);
      const minute = Number(m[5] || 0);
      const second = Number(m[6] || 0);
      return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }
  }
  return new Date(input);
}

function toSqlUtc(input = new Date()) {
  const d = parseDateInput(input);
  return [
    d.getUTCFullYear(),
    '-',
    pad2(d.getUTCMonth() + 1),
    '-',
    pad2(d.getUTCDate()),
    ' ',
    pad2(d.getUTCHours()),
    ':',
    pad2(d.getUTCMinutes()),
    ':',
    pad2(d.getUTCSeconds()),
  ].join('');
}

function nowUtcIso() {
  return new Date().toISOString();
}

function dateKeyInTimeZone(input = new Date(), timeZone = 'Asia/Shanghai') {
  const d = parseDateInput(input);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dateKeyDaysAgo(days, timeZone = 'Asia/Shanghai', input = new Date()) {
  const base = parseDateInput(input);
  return dateKeyInTimeZone(new Date(base.getTime() - (days * 86400000)), timeZone);
}

function formatDateTimeInTimeZone(input, timeZone = 'Asia/Shanghai', withSeconds = false) {
  if (!input) return '';
  const d = parseDateInput(input);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hhmm = `${map.hour}:${map.minute}`;
  return withSeconds
    ? `${map.year}-${map.month}-${map.day} ${hhmm}:${map.second}`
    : `${map.year}-${map.month}-${map.day} ${hhmm}`;
}

// 兼容历史错误写入：若 SQL 时间被当成本地时间写入（例如 datetime('now','localtime')），
// 在按 UTC 解析后会落到“未来”。此处检测后纠偏回 UTC 存储格式。
function normalizeLegacyLocalSqlToUtc(input, localOffsetHours = 8, futureThresholdHours = 4, nowInput = new Date()) {
  if (typeof input !== 'string') return input;
  const s = input.trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return input;

  const parsedAsUtc = parseDateInput(s);
  const now = parseDateInput(nowInput);
  if (Number.isNaN(parsedAsUtc.getTime()) || Number.isNaN(now.getTime())) return input;

  const futureMs = futureThresholdHours * 3600000;
  if (parsedAsUtc.getTime() <= now.getTime() + futureMs) return input;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  const second = Number(m[6] || 0);

  const correctedUtc = new Date(Date.UTC(year, month - 1, day, hour - localOffsetHours, minute, second));
  return toSqlUtc(correctedUtc);
}

module.exports = {
  toSqlUtc,
  nowUtcIso,
  dateKeyInTimeZone,
  dateKeyDaysAgo,
  formatDateTimeInTimeZone,
  parseDateInput,
  normalizeLegacyLocalSqlToUtc,
};
