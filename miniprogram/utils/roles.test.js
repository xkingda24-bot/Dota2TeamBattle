const assert = require('assert');
const {
  VERSATILE_LABEL,
  normalizeRoles,
  hasAllRoles,
  formatRolesText,
  isVersatileText,
} = require('./roles');

// 规范化：过滤非法值、去重、升序
assert.deepStrictEqual(normalizeRoles([3, 1, 3, 5]), [1, 3, 5]);
assert.deepStrictEqual(normalizeRoles([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
assert.deepStrictEqual(normalizeRoles(['5', '1', 4]), [1, 4, 5]);
assert.deepStrictEqual(normalizeRoles([0, 6, 7, 'x', null, undefined]), []);
assert.deepStrictEqual(normalizeRoles(null), []);
assert.deepStrictEqual(normalizeRoles('1,2'), []);

// 全选判定
assert.strictEqual(hasAllRoles([1, 2, 3, 4, 5]), true);
assert.strictEqual(hasAllRoles(['1', '2', '3', '4', '5']), true);
assert.strictEqual(hasAllRoles([1, 2, 3, 4]), false);
assert.strictEqual(hasAllRoles([1, 1, 3, 4, 5]), false, '重复值不应凑成全选');
assert.strictEqual(hasAllRoles([]), false);

// 文案：五个位次折叠为「全能」
assert.strictEqual(VERSATILE_LABEL, '全能');
assert.strictEqual(formatRolesText([1, 2, 3, 4, 5]), '全能');
assert.strictEqual(formatRolesText([5, 4, 3, 2, 1]), '全能');
assert.strictEqual(formatRolesText([1, 2, 3, 4, 5], ' / '), '全能');

// 文案：非全选按分隔符拼接，默认「、」
assert.strictEqual(formatRolesText([3, 1]), '1号位、3号位');
assert.strictEqual(formatRolesText([1, 2, 3, 4]), '1号位、2号位、3号位、4号位');
assert.strictEqual(formatRolesText([1, 4], ' / '), '1号位 / 4号位');
assert.strictEqual(formatRolesText([1], '/'), '1号位');

// 空值不产出文案
assert.strictEqual(formatRolesText([]), '');
assert.strictEqual(formatRolesText(null), '');
assert.strictEqual(formatRolesText([0, 9]), '');

// 旧数据里的「全能」文本识别
assert.strictEqual(isVersatileText('全能'), true);
assert.strictEqual(isVersatileText('1号位 / 3号位'), false);
assert.strictEqual(isVersatileText(null), false);

console.log('mini-program roles utility tests passed.');
