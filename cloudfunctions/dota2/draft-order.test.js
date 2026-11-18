const assert = require('assert');
const { sortCaptainsByMmr } = require('./draft-order');
const { syncRegistrationProfiles } = require('./registration');

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

// 报名记录里的分数可能过期：开始/重置选人前先同步最新资料，再按新分数排序。
const staleRegistrations = [
  { openid: 'captain-a', role: 'captain', mmr: 3000 },
  { openid: 'captain-b', role: 'captain', mmr: 5000 },
];
const latest = syncRegistrationProfiles(staleRegistrations, {
  'captain-a': { mmr: 6000 },
  'captain-b': { mmr: 2000 },
}).registrations;
assert.deepStrictEqual(
  sortCaptainsByMmr(latest).map((captain) => captain.openid),
  ['captain-b', 'captain-a'],
  '队长改分后必须按同步后的最新天梯分重排'
);
assert.deepStrictEqual(latest.map((captain) => captain.mmr), [6000, 2000], '最新分数应写回报名记录');

console.log('draft order tests passed: ascending MMR, stable ties, missing MMR last, latest profile resync');
