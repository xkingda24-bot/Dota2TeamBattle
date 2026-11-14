/**
 * 历史列表分页合并单测：首屏替换、续页追加、跨页重复 id 去重、缺 id 容错。
 */
const { itemId, mergeHistoryPage } = require('./history-merge');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(itemId({ id: 'a' }) === 'a', 'id 优先');
assert(itemId({ _id: 'b' }) === 'b', '_id 兜底');
assert(itemId(null) === '' && itemId({}) === '', '缺 id 应返回空串');

const page1 = [{ id: 't1', name: '一' }, { id: 't2', name: '二' }];
const page2 = [{ id: 't2', name: '二' }, { id: 't3', name: '三' }];

const first = mergeHistoryPage([], page1, true);
assert(first.length === 2 && first[1].id === 't2', '首屏应直接采用新数据');

const merged = mergeHistoryPage(page1, page2, false);
assert(merged.length === 3, '续页应去重后追加，实际 ' + merged.length);
assert(merged.map((item) => item.id).join(',') === 't1,t2,t3', '合并顺序错误');

const reset = mergeHistoryPage(merged, page2, true);
assert(reset.length === 2 && reset[0].id === 't2', '重置应丢弃旧数据');

const withBadRow = mergeHistoryPage([], [{ name: '无 id' }, { id: 'ok' }], false);
assert(withBadRow.length === 1 && withBadRow[0].id === 'ok', '缺 id 的行应被丢弃');

const legacy = mergeHistoryPage([{ _id: 'old' }], [{ _id: 'old' }, { _id: 'new' }], false);
assert(legacy.length === 2 && legacy[1]._id === 'new', '旧字段 _id 也应去重');

console.log('history merge tests passed.');
