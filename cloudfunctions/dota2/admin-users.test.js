const assert = require('assert');
const { RANK_VERIFICATION_TTL } = require('./card-profile');
const { buildAdminUsers, sortAdminUsers, buildAdminRoster, buildCreatePermissionRoster, filterAdminUsers, normalizeAdminUserKeyword } = require('./admin-users');

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
const records = [
  { _id: 'owner-old', _openid: 'user-a', nickname: 'Ada旧', dota2Id: '123456789', mmr: 4042, dota2RankTier: 62, dota2RankVerifiedAt: now - 1000, updatedAt: 100 },
  { _id: 'owner-current', _openid: 'user-a', nickname: 'Ada', dota2Id: '123456789', mmr: 5500, dota2RankTier: 62, dota2RankVerifiedAt: now - 1000, dota2LeaderboardRank: 10, updatedAt: 200 },
  { _id: 'user-b', openid: 'user-b', nickname: '波波', dota2Id: '987654321', mmr: 3000, dota2RankTier: 52, dota2RankVerifiedAt: now - 1000, canCreateTournament: true, updatedAt: 200 },
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
assert.strictEqual(users.find((user) => user.openid === 'user-b').canCreateTournament, true, '用户列表返回创建比赛授权状态');
assert.strictEqual(users.find((user) => user.openid === 'user-c').canCreateTournament, false, '旧用户默认未授权');
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

// 管理员名册：把 openid 列表翻译成带昵称的展示名册（弹窗顶部「普通管理员 2/20：张三、李四」）
assert.deepStrictEqual(
  buildAdminRoster(['user-b', 'user-c'], users, 'user-a').map((item) => item.nickname),
  ['波波', '陈'],
  'openid 列表按原顺序映射到昵称'
);
assert.deepStrictEqual(
  buildAdminRoster([' user-b ', 'user-b', '', null, 'user-c'], users, 'user-a').map((item) => item.openid),
  ['user-b', 'user-c'],
  '空白与重复 openid 被剔除，首尾空格被清理'
);
assert.strictEqual(buildAdminRoster(['no-such-user'], users, 'user-a')[0].nickname, '未设置昵称', '查不到人时给出兜底文案');
assert.strictEqual(buildAdminRoster(['user-a'], users, 'user-a')[0].isSuper, true, '超管出现在名册时会被标记');
assert.deepStrictEqual(buildAdminRoster([], users, 'user-a'), [], '没有管理员时返回空名册');
assert.deepStrictEqual(buildAdminRoster(null, users, 'user-a'), [], '非数组入参返回空名册');
assert.deepStrictEqual(
  buildCreatePermissionRoster(users, [], 'user-a').map((item) => item.nickname),
  ['波波'],
  '创建权限名册集中列出全部已授权普通用户'
);
assert.deepStrictEqual(
  buildCreatePermissionRoster(users, ['user-b'], 'user-a'),
  [],
  '管理员默认可创建，不在普通用户授权名册重复展示'
);

// 用户搜索：用户名模糊匹配（忽略大小写），Dota ID 支持片段，空关键词返回全部。
assert.deepStrictEqual(filterAdminUsers(users, 'ada').map((user) => user.openid), ['user-a']);
assert.deepStrictEqual(filterAdminUsers(users, '654321').map((user) => user.openid), ['user-b']);
assert.deepStrictEqual(filterAdminUsers(users, '  波  ').map((user) => user.openid), ['user-b']);
assert.strictEqual(filterAdminUsers(users, '').length, users.length);
assert.deepStrictEqual(filterAdminUsers(users, '不存在'), []);
assert.strictEqual(normalizeAdminUserKeyword('  AbC  '), 'abc');
assert.strictEqual(normalizeAdminUserKeyword('x'.repeat(40)).length, 30, '搜索词最多保留 30 字');

console.log('Verified admin user listing and search tests passed.');
