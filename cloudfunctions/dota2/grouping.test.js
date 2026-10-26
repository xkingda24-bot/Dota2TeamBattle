const assert = require('assert');
const { validateAutoGroups, replaceAutoGroupMember } = require('./grouping');

const players = [
  { openid: 'a', mmr: 1800 },
  { openid: 'b', mmr: 2200 },
  { openid: 'c', mmr: 1200 },
  { openid: 'd', mmr: 1600 },
];

const valid = validateAutoGroups(players, [['a', 'b'], ['c', 'd']], 2, 2);
assert.deepStrictEqual(valid.groups.map((group) => group.map((player) => player.openid)), [['b', 'a'], ['d', 'c']]);
assert.strictEqual(validateAutoGroups(players, [['a', 'b']], 2, 2).error, '分组数据不正确（组数不符）');
assert.strictEqual(validateAutoGroups(players, [['a', 'b'], ['c']], 2, 2).error, '第 2 组人数不正确（需恰好 2 人）');
assert.strictEqual(validateAutoGroups(players, [['a', 'b'], ['a', 'd']], 2, 2).error, '分组数据不正确（重复或非报名队员）');
assert.strictEqual(validateAutoGroups(players, [['a', 'b'], ['c', 'x']], 2, 2).error, '分组数据不正确（重复或非报名队员）');
assert.strictEqual(validateAutoGroups(players, [['a', 'b'], ['c', 'd']], 2, 3).error, '报名队员数量与分组名额不符');

const team = {
  captain: { openid: 'a', nickname: 'A', mmr: 2000, teamName: '夜魇', teamIcon: 'wolf' },
  players: [{ openid: 'b', nickname: 'B', mmr: 1800 }],
};
const registrations = [
  { openid: 'a', nickname: 'A', mmr: 2000, role: 'player' },
  { openid: 'b', nickname: 'B', mmr: 1800, role: 'player' },
  { openid: 'sub', nickname: '替补', mmr: 2400, role: 'waitlist' },
];
const replaceCaptain = replaceAutoGroupMember(team, registrations, 'a', 'sub', { cardStyle: { animation: 'arcane' } });
assert.strictEqual(replaceCaptain.error, undefined);
assert.strictEqual(replaceCaptain.team.captain.openid, 'sub');
assert.strictEqual(replaceCaptain.team.captain.teamName, '夜魇');
assert.strictEqual(replaceCaptain.team.captain.teamIcon, 'wolf');
assert.strictEqual(replaceCaptain.team.players[0].openid, 'b');
assert.strictEqual(replaceCaptain.registrations.find((item) => item.openid === 'a').role, 'waitlist');
assert.strictEqual(replaceCaptain.registrations.find((item) => item.openid === 'sub').role, 'player');

const replaceMemberAndPromote = replaceAutoGroupMember(team, registrations, 'b', 'sub', {});
assert.strictEqual(replaceMemberAndPromote.team.captain.openid, 'sub');
assert.strictEqual(replaceMemberAndPromote.team.players[0].openid, 'a');
assert.strictEqual(replaceAutoGroupMember(team, registrations, 'missing', 'sub', {}).error, '换下队员资料已失效');

console.log('Auto grouping validation and substitution tests passed.');
