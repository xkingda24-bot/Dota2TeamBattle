const assert = require('assert');
const { formatHonors, normalizeHonors } = require('./honors');

// 文案：固定三段，缺省一律写 0，保证全站名片同一读法
assert.strictEqual(formatHonors({ champions: 3, runnersUp: 2, thirds: 1 }), '3 冠 2 亚 1 季');
assert.strictEqual(formatHonors({ champions: 0, runnersUp: 2, thirds: 0 }), '0 冠 2 亚 0 季');
assert.strictEqual(formatHonors({ champions: 1, runnersUp: 0, thirds: 0 }), '1 冠 0 亚 0 季');
// 全 0 / 缺字段 / 空对象 / null 也要写出来，不隐藏
assert.strictEqual(formatHonors({ champions: 0, runnersUp: 0, thirds: 0 }), '0 冠 0 亚 0 季');
assert.strictEqual(formatHonors({}), '0 冠 0 亚 0 季');
assert.strictEqual(formatHonors(null), '0 冠 0 亚 0 季');
assert.strictEqual(formatHonors(undefined), '0 冠 0 亚 0 季');

// 归一：字符串数字、非法值、缺字段
assert.deepStrictEqual(normalizeHonors({ champions: '2', runnersUp: 1 }), { champions: 2, runnersUp: 1, thirds: 0 });
assert.deepStrictEqual(normalizeHonors({ champions: -1, runnersUp: 'x', thirds: null }), { champions: -1, runnersUp: 0, thirds: 0 });
assert.deepStrictEqual(normalizeHonors(null), { champions: 0, runnersUp: 0, thirds: 0 });

console.log('mini-program honors utility tests passed.');
