/**
 * 历史列表筛选条件单测（不连数据库，只检查生成的 where 结构）。
 * 重点：选中赛季时，未归档/未结束的比赛也要能按创建时间被查到。
 */
const { buildHistoryFilter } = require('./tournaments');
const { describeHistoryQuery } = require('./history-query');
const { getSeasonById } = require('./season-window');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const TODAY = Date.parse('2026-11-15T00:00:00+08:00');
const Q4 = getSeasonById('2026Q4');

// 不选赛季：往期 + 今天已归档 两段
const all = buildHistoryFilter(describeHistoryQuery({ todayStart: TODAY, limit: 20 }));
assert(all.operator === 'or' && all.operands.length === 2, '默认应为 2 段条件');
assert(all.operands[1].archivedAt && all.operands[1].archivedAt.operator === 'gt' && all.operands[1].archivedAt.operands[0] === 0, '今天段应要求已归档');

// 选中赛季：往期已归档 + 往期未归档 + 今天已归档 三段
const q4 = buildHistoryFilter(describeHistoryQuery({ todayStart: TODAY, seasonId: '2026Q4', limit: 20 }));
assert(q4.operator === 'or' && q4.operands.length === 3, '选中赛季应为 3 段条件');

const unarchived = q4.operands.find((item) => item.archivedAt === null);
assert(!!unarchived, '选中赛季必须包含未归档/未结束比赛的分支');
assert(unarchived.createdAt && unarchived.createdAt.operator === 'and', '未归档分支应按创建时间区间过滤');
const bounds = unarchived.createdAt.operands;
assert(bounds.some((b) => b.operator === 'gte' && b.operands[0] === Q4.startAt), '未归档分支创建时间下界应为赛季起点');
assert(bounds.some((b) => b.operator === 'lt' && b.operands[0] === Math.min(Q4.endAt, TODAY)), '未归档分支创建时间上界应为赛季终点与今天边界的较小值');

const archived = q4.operands.find((item) => item.archivedAt && item.archivedAt.operator === 'and');
assert(!!archived, '已归档分支仍按归档时间过滤');

// 翻页游标：未归档分支的创建时间上界不能超过游标
const paged = buildHistoryFilter(describeHistoryQuery({
  todayStart: TODAY,
  seasonId: '2026Q4',
  cursorCreatedAt: 1762000000000,
  cursorId: 'abc',
}));
const pagedUnarchived = paged.operands.find((item) => item.archivedAt === null);
assert(pagedUnarchived.createdAt.operands.some((b) => b.operator === 'lt' && b.operands[0] === 1762000000001), '游标应继续约束未归档分支');

// 没有 todayStart 的兜底分支：同样要包含未归档比赛
const noToday = buildHistoryFilter(describeHistoryQuery({ seasonId: '2026Q2' }));
assert(noToday.operator === 'or' && noToday.operands.length === 2, '无 todayStart 时赛季应为 2 段');
assert(noToday.operands.some((item) => item.archivedAt === null), '无 todayStart 时也要包含未归档分支');

console.log('history filter tests passed.');
