function formatDateTime(value) {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric)
    ? (numeric > 0 && numeric < 1e11 ? numeric * 1000 : numeric)
    : Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const pad = (part) => String(part).padStart(2, '0');
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/* 比赛"今日/历史"分界线：以早上 6:00 为一天的起点。
 * 创建时间 >= 今天 6:00 的比赛显示在"今天的比赛"栏；更早的在历史栏。
 * 即"今日"窗口 = [今天 6:00, 第二天 6:00)。 */
function getTodayBoundary(now) {
  const date = now instanceof Date ? now : new Date(Number(now) || Date.now());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0, 0, 0).getTime();
}

module.exports = { formatDateTime, getTodayBoundary };
