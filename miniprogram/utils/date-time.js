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

/* 比赛"今日/历史"分界线：最近一个已经到来的早上 6:00。
 * - 当前时刻 >= 今天 6:00  → 分界线为今天 6:00（今天 6:00 之后创建的在今日栏）
 * - 当前时刻 <  今天 6:00  → 分界线为昨天 6:00（凌晨 0-6 点仍属于"昨天 6:00 起的一天"，
 *   昨晚乃至今天凌晨创建的比赛都留在今日栏，到今天 6:00 才掉入历史栏）
 * 即每场比赛在创建后第一次经过的早上 6:00 自动进入历史栏。 */
function getTodayBoundary(now) {
  const date = now instanceof Date ? now : new Date(Number(now) || Date.now());
  const todaySix = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0, 0, 0).getTime();
  if (date.getTime() >= todaySix) return todaySix;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1, 6, 0, 0, 0).getTime();
}

module.exports = { formatDateTime, getTodayBoundary };
