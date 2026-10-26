const assert = require('assert');
const { selectUserRecord, buildUserMap } = require('./user-records');

const oldOwner = { _id: 'owner-a', _openid: 'player-a', nickname: '旧昵称', updatedAt: 100 };
const currentOwner = {
  _id: 'owner-b',
  _openid: 'player-a',
  nickname: 'Ada',
  dota2Id: '399945281',
  dota2MmrVerified: 4042,
  dota2RankLabel: '万古2',
  updatedAt: 200,
};
const newerLegacy = { _id: 'legacy-z', openid: 'player-a', nickname: '旧版资料', updatedAt: 300 };
const mismatchedOwner = {
  _id: 'mismatched-owner',
  _openid: 'player-a',
  openid: 'player-b',
  nickname: '身份字段不一致',
  updatedAt: 400,
};

assert.strictEqual(selectUserRecord([oldOwner, currentOwner]), currentOwner);
assert.deepStrictEqual(
  buildUserMap(
    ['player-a', 'player-b', 'player-c'],
    [oldOwner, currentOwner, mismatchedOwner],
    [newerLegacy, mismatchedOwner, { _id: 'legacy-b', openid: 'player-b', nickname: 'Legacy B' }]
  ),
  {
    // Even when an owned record is newer, its _openid identity and owner precedence win.
    'player-a': mismatchedOwner,
    'player-b': { _id: 'legacy-b', openid: 'player-b', nickname: 'Legacy B' },
  }
);

console.log('Verified user record consistency tests passed.');
