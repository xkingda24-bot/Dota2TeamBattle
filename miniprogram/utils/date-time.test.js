// 今日/历史分界线（最近一个已到来的早上 6:00）的日期计算测试。
const assert = require('assert');
const { getTodayBoundary } = require('./date-time');

const todaySix = new Date(2026, 10, 6, 6, 0, 0, 0).getTime();
const yesterdaySix = new Date(2026, 10, 5, 6, 0, 0, 0).getTime();
const at = (d, h, m, s) => new Date(2026, 10, d, h, m, s || 0).getTime();

// 0-6 点（今天还未到 6:00）：分界线 = 昨天 6:00
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 0, 0, 0)), yesterdaySix);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 2, 0, 0)), yesterdaySix);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 5, 59, 59)), yesterdaySix);

// 6:00 及之后：分界线 = 今天 6:00
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 6, 0, 0)), todaySix);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 6, 0, 1)), todaySix);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 14, 0, 0)), todaySix);
assert.strictEqual(getTodayBoundary(new Date(2026, 10, 6, 23, 59, 59)), todaySix);

// 用户诉求逐条验证（今天是 11-06）：
// 1) 今天 02:00 创建：凌晨 02:00 查看在今日栏，今天 06:00 查看掉入历史
const createdThisDay2 = at(6, 2, 0);
assert.strictEqual(createdThisDay2 >= getTodayBoundary(new Date(2026, 10, 6, 2, 0, 0)), true, '02:00 创建、02:00 查看 → 今日栏');
assert.strictEqual(createdThisDay2 >= getTodayBoundary(new Date(2026, 10, 6, 5, 59, 59)), true, '02:00 创建、05:59 查看 → 今日栏');
assert.strictEqual(createdThisDay2 >= getTodayBoundary(new Date(2026, 10, 6, 6, 0, 0)), false, '02:00 创建、06:00 查看 → 历史栏');

// 2) 昨晚 23:00 创建：今天凌晨仍在今日栏，今天 06:00 掉入历史
const createdYesterday23 = at(5, 23, 0);
assert.strictEqual(createdYesterday23 >= getTodayBoundary(new Date(2026, 10, 6, 1, 0, 0)), true, '昨晚23:00创建、今天01:00查看 → 今日栏');
assert.strictEqual(createdYesterday23 >= getTodayBoundary(new Date(2026, 10, 6, 6, 0, 1)), false, '昨晚23:00创建、今天06:00后查看 → 历史栏');

// 3) 今天 14:00 创建：明天 06:00 才掉入历史
const createdThisDay14 = at(6, 14, 0);
assert.strictEqual(createdThisDay14 >= getTodayBoundary(new Date(2026, 10, 7, 5, 59, 59)), true, '今天14:00创建、明天05:59查看 → 今日栏');
assert.strictEqual(createdThisDay14 >= getTodayBoundary(new Date(2026, 10, 7, 6, 0, 0)), false, '今天14:00创建、明天06:00查看 → 历史栏');

// 跨月边界：11-30 23:00 创建，12-01 05:59 仍在今日栏
const createdNov30 = new Date(2026, 10, 30, 23, 0, 0).getTime();
assert.strictEqual(createdNov30 >= getTodayBoundary(new Date(2026, 11, 1, 5, 59, 59)), true);
assert.strictEqual(createdNov30 >= getTodayBoundary(new Date(2026, 11, 1, 6, 0, 0)), false);

// 数字时间戳入参等价于 Date 入参
assert.strictEqual(getTodayBoundary(at(6, 2, 0)), yesterdaySix);

console.log('getTodayBoundary tests passed (nearest passed 6:00 boundary).');
