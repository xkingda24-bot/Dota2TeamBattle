/**
 * 赛季窗口单测：与 seasonPoints/core.js 的 SEASONS 保持同一口径（2026 年按季度）。
 */
const { SEASONS, getSeasonById, seasonOfTimestamp, listSeasonOptions } = require('./season-window');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const Q1_START = Date.parse('2026-01-01T00:00:00+08:00');
const Q2_START = Date.parse('2026-04-01T00:00:00+08:00');
const Q3_START = Date.parse('2026-07-01T00:00:00+08:00');
const Q4_START = Date.parse('2026-10-01T00:00:00+08:00');
const Q4_END = Date.parse('2027-01-01T00:00:00+08:00');

assert(SEASONS.length === 4, '应有 4 个赛季');
assert(SEASONS[0].startAt === Q1_START && SEASONS[0].endAt === Q2_START, 'Q1 区间错误');
assert(SEASONS[1].startAt === Q2_START && SEASONS[1].endAt === Q3_START, 'Q2 区间错误');
assert(SEASONS[2].startAt === Q3_START && SEASONS[2].endAt === Q4_START, 'Q3 区间错误');
assert(SEASONS[3].startAt === Q4_START && SEASONS[3].endAt === Q4_END, 'Q4 区间错误');
// 季度首尾必须严格衔接，不能重叠也不能留空档
assert(SEASONS[0].endAt === SEASONS[1].startAt
  && SEASONS[1].endAt === SEASONS[2].startAt
  && SEASONS[2].endAt === SEASONS[3].startAt, '赛季区间不连续');

assert(getSeasonById('2026Q3').label === '2026 Q3', '按 id 取赛季失败');
assert(getSeasonById('2025Q4') === null, '未知赛季应返回 null');
assert(getSeasonById('') === null, '空 id 应返回 null');

assert(seasonOfTimestamp(Q1_START).seasonId === '2026Q1', 'Q1 起点归属错误');
assert(seasonOfTimestamp(Q2_START - 1).seasonId === '2026Q1', 'Q1 最后一毫秒归属错误');
assert(seasonOfTimestamp(Q2_START).seasonId === '2026Q2', 'Q2 起点归属错误');
assert(seasonOfTimestamp(Date.parse('2026-11-15T12:00:00+08:00')).seasonId === '2026Q4', '当前时间应落在 Q4');
assert(seasonOfTimestamp(Q4_END) === null, 'Q4 之后的归档时间不应匹配任何赛季');
assert(seasonOfTimestamp(0) === null, '未归档（无时间戳）应返回 null');

const options = listSeasonOptions();
assert(options.length === SEASONS.length, '赛季选项数量错误');
assert(options[0].seasonId === '2026Q1' && options[3].label === '2026 Q4', '赛季选项内容错误');
assert(!('startAt' in options[0]), '前端选项不应下发时间戳');

console.log('season window tests passed.');
