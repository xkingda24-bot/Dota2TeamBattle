/**
 * 报名分享文案单测：缺口计算、各阶段标题、边界（0 人、已满、只有替补）。
 */
const assert = require('assert');
const { buildRegisterShareTitle, buildCapacity } = require('./share-text');

function tournament(overrides) {
  return Object.assign({
    name: '周五内战',
    mode: 'captain',
    N: 8,
    K: 2,
    status: 'registration',
    captainFilled: 8,
    playerFilled: 12,
    waitLimit: 0,
    waitlistFilled: 0,
  }, overrides || {});
}

/* 队员没满：标题给出还差几人 */
assert.strictEqual(
  buildRegisterShareTitle(tournament()),
  '周五内战 · 8 队局还差 4 人'
);

/* 队长没满时优先喊队长，比喊队员更急 */
assert.strictEqual(
  buildRegisterShareTitle(tournament({ captainFilled: 6 })),
  '周五内战 · 还差 2 位队长开车'
);

/* 人齐但有替补位：不要再说「还差 0 人」 */
assert.strictEqual(
  buildRegisterShareTitle(tournament({ playerFilled: 16, waitLimit: 3 })),
  '周五内战 · 人已齐，替补还有 3 个位置'
);

/* 全满：改成邀请看阵容 */
assert.strictEqual(
  buildRegisterShareTitle(tournament({ playerFilled: 16 })),
  '周五内战 · 人已齐，来看阵容'
);

/* 系统分组模式没有队长名额，只算队员 */
assert.strictEqual(
  buildRegisterShareTitle(tournament({ mode: 'auto', captainFilled: 0, playerFilled: 15 })),
  '周五内战 · 8 队局还差 1 人'
);

/* 已过报名阶段：文案改成看赛程/名次，不再喊报名 */
assert.strictEqual(buildRegisterShareTitle(tournament({ status: 'battle' })), '周五内战 · 正在对战，来看赛程');
assert.strictEqual(buildRegisterShareTitle(tournament({ status: 'finished' })), '周五内战 · 已结算，来看最终名次');
assert.strictEqual(buildRegisterShareTitle(tournament({ status: 'draft' })), '周五内战 · 选人中，来看阵容');

/* 名字缺失时回落到默认名，不出现「undefined」 */
assert.strictEqual(buildRegisterShareTitle({}), '刀塔集结 · 人已齐，来看阵容');

/* 缺口不会出现负数 */
const capacity = buildCapacity(tournament({ captainFilled: 99, playerFilled: 99 }));
assert.strictEqual(capacity.captainNeed, 0);
assert.strictEqual(capacity.playerNeed, 0);
assert.strictEqual(capacity.full, true);

console.log('share text tests passed.');
