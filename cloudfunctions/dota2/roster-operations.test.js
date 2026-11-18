const assert = require('assert');
const { swapCaptainRoster, replaceCaptainDraftRoster } = require('./roster-operations');

const draft = {
  mode: 'captain',
  status: 'draft',
  matches: [],
  draft: { turn: 4, picks: [['a1', 'a2'], ['b1', 'b2']] },
  registrations: [
    { openid: 'a1', role: 'player' },
    { openid: 'b1', role: 'player' },
  ],
};
const draftResult = swapCaptainRoster(draft, { teamAIndex: 0, openidA: 'a1', teamBIndex: 1, openidB: 'b1' });
assert.deepStrictEqual(draftResult.data.draft.picks, [['b1', 'a2'], ['a1', 'b2']], '选人名单应按队伍交换');
assert.deepStrictEqual(draft.registrations.map((item) => item.role), ['player', 'player'], '交换不改变报名角色');
assert.deepStrictEqual(draft.draft.picks, [['a1', 'a2'], ['b1', 'b2']], '不能修改原赛事对象');
assert.strictEqual(swapCaptainRoster(draft, { teamAIndex: 0, openidA: 'a1', teamBIndex: 0, openidB: 'a2' }).error, '请选择不同队伍的两名队员进行交换');
assert(swapCaptainRoster(draft, { teamAIndex: 0, openidA: 'nobody', teamBIndex: 1, openidB: 'b1' }).error);

const battle = {
  mode: 'captain',
  status: 'battle',
  matches: [],
  teams: [
    { captain: { openid: 'cap-a' }, players: [{ openid: 'a1', nickname: 'A1' }] },
    { captain: { openid: 'cap-b' }, players: [{ openid: 'b1', nickname: 'B1' }] },
  ],
};
const battleResult = swapCaptainRoster(battle, { teamAIndex: 0, openidA: 'a1', teamBIndex: 1, openidB: 'b1' });
assert.strictEqual(battleResult.data.teams[0].players[0].nickname, 'B1', '对战阶段交换完整队员资料');
assert.strictEqual(battleResult.data.teams[1].players[0].nickname, 'A1');
assert.strictEqual(battleResult.data.teams[0].captain.openid, 'cap-a', '队长不随队员交换');
assert(swapCaptainRoster(Object.assign({}, battle, { matches: [{ status: 'done' }] }), { teamAIndex: 0, openidA: 'a1', teamBIndex: 1, openidB: 'b1' }).error, '已有比分后禁止交换');

const replaceBase = {
  draft: { picks: [['a1'], ['b1']] },
  registrations: [
    { openid: 'a1', role: 'player' },
    { openid: 'b1', role: 'player' },
    { openid: 'unused', role: 'player' },
    { openid: 'sub', role: 'waitlist' },
  ],
};
const unselected = replaceCaptainDraftRoster(replaceBase, { teamIndex: 0, outOpenid: 'a1', inOpenid: 'unused' });
assert.deepStrictEqual(unselected.data.draft.picks, [['unused'], ['b1']]);
assert.strictEqual(unselected.data.registrations.find((item) => item.openid === 'a1').role, 'player', '换成未选队员时换下者仍在未选池');
assert.strictEqual(unselected.data.registrations.find((item) => item.openid === 'unused').role, 'player');
const substituted = replaceCaptainDraftRoster(replaceBase, { teamIndex: 0, outOpenid: 'a1', inOpenid: 'sub' });
assert.deepStrictEqual(substituted.data.draft.picks, [['sub'], ['b1']]);
assert.strictEqual(substituted.data.registrations.find((item) => item.openid === 'a1').role, 'waitlist', '替补上场后换下者进入替补席');
assert.strictEqual(substituted.data.registrations.find((item) => item.openid === 'sub').role, 'player', '替补换入后成为正式队员');
assert.strictEqual(replaceBase.registrations.find((item) => item.openid === 'a1').role, 'player', '替换不能修改原报名记录');
assert(replaceCaptainDraftRoster(replaceBase, { teamIndex: 0, outOpenid: 'a1', inOpenid: 'b1' }).error, '已选队员不能重复换入');

console.log('Captain roster swap and replacement tests passed.');
