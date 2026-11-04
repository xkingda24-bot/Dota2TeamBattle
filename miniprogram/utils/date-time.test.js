// 今日/历史分界线（早上 6:00 为一天起点）的日期计算测试。
const assert = require('assert');
const { getTodayBoundary } = require('./date-time');

const at = (h, m, s) => new Date(2026, 10, 5, h, m, s || 0).getTime();
const boundary = new Date(2026, 10, 5, 6, 0, 0, 0).getTime();

// 同一天任何时刻（含凌晨 0-6 点）的分界点都是当天 6:00
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 5, 2, 0, 0)), boundary);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 5, 0, 0, 0)), boundary);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 5, 23, 59, 59)), boundary);
assert.strictEqual(getTodayBoundary(at(6, 0, 0)), boundary);
assert.strictEqual(getTodayBoundary(at(6, 0, 1)), boundary);

// 分界点前后 1 秒：越过分界点创建才属于"今日"
const justBefore = at(5, 59, 59);
const justAfter = at(6, 0, 1);
assert.strictEqual(justBefore >= boundary, false, '05:59:59 创建应归历史');
assert.strictEqual(justAfter >= boundary, true, '06:00:01 创建应归今日');

// 跨月/跨年边界：分界点仍落在"当天"的 6:00
assert.strictEqual(getTodayBoundary(new Date(2026, 11, 31, 23, 0, 0)), new Date(2026, 11, 31, 6, 0, 0, 0).getTime());
assert.strictEqual(getTodayBoundary(new Date(2027, 0, 1, 1, 0, 0)), new Date(2027, 0, 1, 6, 0, 0, 0).getTime());

// 数字时间戳入参等价于 Date 入参
assert.strictEqual(getTodayBoundary(at(2, 0, 0)), boundary);

console.log('getTodayBoundary tests passed (6:00 day boundary).');
