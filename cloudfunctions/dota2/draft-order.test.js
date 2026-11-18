const assert = require('assert');
const { sortCaptainsByMmr } = require('./draft-order');

const captains = [
  { openid: 'high', mmr: 5200 },
  { openid: 'missing', mmr: null },
  { openid: 'low-first', mmr: 3000 },
  { openid: 'low-second', mmr: 3000 },
  { openid: 'zero', mmr: 0 },
  { openid: 'middle', mmr: 4100 },
  { openid: 'invalid', mmr: 'not-a-number' },
];
const original = captains.slice();

assert.deepStrictEqual(
  sortCaptainsByMmr(captains).map((captain) => captain.openid),
  ['low-first', 'low-second', 'middle', 'high', 'missing', 'zero', 'invalid'],
  '应低分先选，同分保持报名顺序，未填写或无效分数排最后并保持报名顺序'
);
assert.deepStrictEqual(captains, original, '排序不能修改原报名数组');
assert.deepStrictEqual(sortCaptainsByMmr(null), [], '没有队长时返回空数组');

console.log('draft order tests passed: ascending MMR, stable ties, missing MMR last');
