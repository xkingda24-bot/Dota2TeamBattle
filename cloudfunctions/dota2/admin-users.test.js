const assert = require('assert');
const { RANK_VERIFICATION_TTL } = require('./card-profile');
const { buildAdminUsers, sortAdminUsers } = require('./admin-users');

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
const records = [
  { _id: 'owner-old', _openid: 'user-a', nickname: 'Ada旧', dota2Id: '123456789', mmr: 4042, dota2RankTier: 62, dota2RankVerifiedAt: now - 1000, updatedAt: 100 },
  { _id: 'owner-current', _openid: 'user-a', nickname: 'Ada', dota2Id: '123456789', mmr: 5500, dota2RankTier: 62, dota2RankVerifiedAt: now - 1000, dota2LeaderboardRank: 10, updatedAt: 200 },
  { _id: 'user-b', openid: 'user-b', nickname: '波波', dota2Id: '987654321', mmr: 3000, dota2RankTier: 52, dota2RankVerifiedAt: now - 1000, updatedAt: 200 },
  { _id: 'user-c', _openid: 'user-c', nickname: '陈', mmr: null, updatedAt: 100 },
  { _id: 'user-d', _openid: 'user-d', nickname: '丁', dota2Id: '200000000', mmr: 7000, dota2RankTier: 75, dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL, updatedAt: 100 },
  { _id: 'user-e', _openid: 'user-e', nickname: '', mmr: 5000, updatedAt: 100 },
];

const users = buildAdminUsers(records, 'user-a', 'nickname', 'asc', now);
assert.strictEqual(users.length, 5, 'duplicate records map to one user and users without nicknames remain in the list');
assert.strictEqual(users.find((user) => user.openid === 'user-a').nickname, 'Ada');
assert.strictEqual(users.find((user) => user.openid === 'user-a').mmr, 5500);
assert.strictEqual(users.find((user) => user.openid === 'user-a').isSuper, true);
assert.strictEqual(Object.prototype.hasOwnProperty.call(users.find((user) => user.openid === 'user-b'), 'isAdmin'), false);
assert.strictEqual(users.find((user) => user.openid === 'user-d').dota2RankLabel, '未校验段位');
assert.deepStrictEqual(users.slice(-1).map((user) => user.openid), ['user-e']);

assert.deepStrictEqual(
  sortAdminUsers([
    { openid: 'a', nickname: 'A', dota2Id: '', mmr: null, dota2RankTier: null },
    { openid: 'b', nickname: 'B', dota2Id: '1000', mmr: 4500, dota2RankTier: 52 },
    { openid: 'c', nickname: 'C', dota2Id: '200', mmr: 3000, dota2RankTier: 62 },
  ], 'dota2Id', 'asc').map((user) => user.openid),
  ['c', 'b', 'a'],
  'Dota IDs use numeric ordering and empty values remain last'
);
assert.deepStrictEqual(
  sortAdminUsers([
    { openid: 'a', nickname: 'A', mmr: 4500 },
    { openid: 'b', nickname: 'B', mmr: null },
    { openid: 'c', nickname: 'C', mmr: 3000 },
  ], 'mmr', 'desc').map((user) => user.openid),
  ['a', 'c', 'b'],
  'descending numeric sort keeps empty values last'
);

console.log('Verified admin user listing tests passed.');
