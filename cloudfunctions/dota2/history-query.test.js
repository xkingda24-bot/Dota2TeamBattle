/**
 * 历史列表查询参数单测：分页上限、游标、赛季区间、搜索关键字。
 */
const { DEFAULT_LIMIT, MAX_LIMIT, MAX_KEYWORD, describeHistoryQuery, escapeRegExp } = require('./history-query');
const { getSeasonById } = require('./season-window');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = describeHistoryQuery({});
assert(defaults.limit === DEFAULT_LIMIT, '默认分页大小错误');
assert(defaults.todayStart === 0 && defaults.cursorCreatedAt === 0 && defaults.cursorId === '', '默认游标应为空');
assert(defaults.season === null && defaults.seasonId === '', '默认不应带赛季筛选');
assert(defaults.regexp === '', '默认不应带搜索正则');

assert(describeHistoryQuery({ limit: 999 }).limit === MAX_LIMIT, '分页大小应被限制在上限');
assert(describeHistoryQuery({ limit: 0 }).limit === DEFAULT_LIMIT, '非法分页大小应回退默认值');
assert(describeHistoryQuery({ limit: '5' }).limit === 5, '字符串分页大小应可解析');
assert(describeHistoryQuery({ limit: 12.9 }).limit === 12, '分页大小应取整');

const cursor = describeHistoryQuery({ cursorCreatedAt: '1760000000000', cursorId: '  abc123  ' });
assert(cursor.cursorCreatedAt === 1760000000000, '游标时间戳解析错误');
assert(cursor.cursorId === 'abc123', '游标 id 应去除首尾空白');

const season = describeHistoryQuery({ seasonId: '2026Q3' });
const q3 = getSeasonById('2026Q3');
assert(season.season && season.season.startAt === q3.startAt && season.season.endAt === q3.endAt, '赛季区间应透传');
assert(season.seasonId === '2026Q3', '赛季 id 应保留');

let unknownSeasonError = null;
try {
  describeHistoryQuery({ seasonId: '2025Q1' });
} catch (e) {
  unknownSeasonError = e;
}
assert(!!unknownSeasonError && unknownSeasonError.code === 'UNKNOWN_SEASON', '未知赛季应抛错并带错误码');

const keyword = describeHistoryQuery({ keyword: '  秋季赛  ' });
assert(keyword.keyword === '秋季赛', '关键字应去除首尾空白');
assert(keyword.regexp === '秋季赛', '中文关键字不应被转义');
const longKeyword = describeHistoryQuery({ keyword: 'x'.repeat(60) });
assert(longKeyword.keyword.length === MAX_KEYWORD, '关键字应被截断');

assert(escapeRegExp('a.b*c(d)') === 'a\\.b\\*c\\(d\\)', '正则特殊字符应被转义');
assert(escapeRegExp('TI 2026 (秋季)') === 'TI 2026 \\(秋季\\)', '中英混排关键字转义错误');

const combined = describeHistoryQuery({
  todayStart: 1760000000000,
  cursorCreatedAt: 1759000000000,
  cursorId: 'tid',
  seasonId: '2026Q2',
  keyword: '(决赛)',
  limit: 3,
});
assert(combined.limit === 3 && combined.seasonId === '2026Q2' && combined.regexp === '\\(决赛\\)', '组合参数解析错误');

const { applySettlementStates } = require('./history-query');
const rows = [
  { id: 'done', name: '已结算' },
  { id: 'running', name: '结算中' },
  { id: 'broken', name: '结算失败' },
  { id: 'none', name: '没跑过结算' },
  { _id: 'legacy', name: '旧字段 id' },
];
const flagged = applySettlementStates(rows, {
  done: 'settled',
  running: 'processing',
  broken: 'failed',
  legacy: 'settled',
});
assert(flagged[0].settled === true, 'settled 才算已结算');
assert(flagged[1].settled === false && flagged[1].settlementStatus === 'processing', '结算中断应算未结算');
assert(flagged[2].settled === false, '结算失败应算未结算');
assert(flagged[3].settled === false && flagged[3].settlementStatus === '', '没有结算记录应算未结算');
assert(flagged[4].settled === true, '旧字段 _id 也应能匹配');
assert(applySettlementStates(null, {}).length === 0, '空列表应安全返回');

console.log('history query tests passed.');
