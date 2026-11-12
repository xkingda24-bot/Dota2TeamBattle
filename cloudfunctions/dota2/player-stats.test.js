/**
 * 生涯统计单测：名次、胜负、胜率、搭档、连胜、落位反查。
 * 纯函数，不需要 wx-server-sdk。
 */
const assert = require('assert');
const { buildPlayerStats } = require('./player-stats');

function teamSource(slot, name) {
  return { type: 'team', openid: 'T' + slot, name };
}

function player(id, nickname) {
  return { openid: id, nickname };
}

function captain(id, nickname, teamName) {
  return { openid: id, nickname, teamName };
}

/* 两支队伍的完整双败：T0 全胜，T0 队员 b 也是全胜 */
function twoTeamTournament(overrides) {
  return Object.assign({
    _id: 't1',
    name: '周五内战',
    time: '2026-11-13 20:00',
    bracketType: 'double',
    N: 2,
    K: 1,
    createdAt: 1000,
    teams: [
      { captain: captain('a', '阿A', '战神队'), players: [player('b', '小B')] },
      { captain: captain('c', '阿C', '梦之队'), players: [player('d', '小D')] },
    ],
    matches: [
      { id: 1, stage: 'UB1', teamA: teamSource(0, '战神队'), teamB: teamSource(1, '梦之队'), status: 'done', winner: 'T0' },
      { id: 2, stage: 'LB1', teamA: { type: 'match', matchId: 1, slot: 'winner' }, teamB: { type: 'match', matchId: 1, slot: 'loser' }, status: 'done', winner: 'T0' },
      { id: 3, stage: 'GF', isChampionMatch: true, teamA: { type: 'match', matchId: 2, slot: 'winner' }, teamB: { type: 'match', matchId: 2, slot: 'loser' }, status: 'done', winner: 'T0' },
    ],
  }, overrides || {});
}

function testChampionStats() {
  const stats = buildPlayerStats([twoTeamTournament()], 'b');
  assert.strictEqual(stats.registered, 1, '报名场次');
  assert.strictEqual(stats.playedTournaments, 1, '上场赛事数');
  assert.strictEqual(stats.matches, 3, '比赛场次');
  assert.strictEqual(stats.wins, 3, '胜场');
  assert.strictEqual(stats.losses, 0, '负场');
  assert.strictEqual(stats.winRate, 100, '胜率');
  assert.strictEqual(stats.championships, 1, '冠军数');
  assert.strictEqual(stats.bestStreak, 3, '最佳连胜');
  assert.strictEqual(stats.currentStreak, 3, '当前连胜');
  assert.strictEqual(stats.captainTimes, 0, '非队长');
  assert.strictEqual(stats.placements.length, 1, '名次记录');
  assert.strictEqual(stats.placements[0].rank, 1, '名次');
  assert.strictEqual(stats.placements[0].label, '冠军', '名次文案');
  assert.strictEqual(stats.placements[0].teamName, '战神队', '队伍名');
  assert.strictEqual(stats.partners.length, 1, '搭档数');
  assert.strictEqual(stats.partners[0].openid, 'a', '搭档 openid');
  assert.strictEqual(stats.partners[0].matches, 3, '搭档同场次数');
  assert.strictEqual(stats.partners[0].winRate, 100, '搭档胜率');
}

/* 落位表反序时，队伍下标 0 在赛程里是 T1；本用例里 T1 全败，按队伍下标误判会算成全胜 */
function testSeedingReverse() {
  const tournament = twoTeamTournament({ _id: 't2', seeding: [1, 0], createdAt: 2000 });
  const stats = buildPlayerStats([tournament], 'b');
  assert.strictEqual(stats.matches, 3, '落位反序仍能对上自己的比赛');
  assert.strictEqual(stats.wins, 0, '落位反序：T1 全败，不能误判成 T0 的胜利');
  assert.strictEqual(stats.losses, 3, '落位反序负场');
  assert.strictEqual(stats.runnerUps, 1, '落位反序名次为亚军');
}

/* 失败的一场：胜率与连胜都要跟着变 */
function testLossAndStreak() {
  const tournament = twoTeamTournament({
    _id: 't3',
    createdAt: 3000,
    matches: [
      { id: 1, stage: 'UB1', teamA: teamSource(0, '战神队'), teamB: teamSource(1, '梦之队'), status: 'done', winner: 'T1' },
      { id: 2, stage: 'LB1', teamA: { type: 'match', matchId: 1, slot: 'loser' }, teamB: { type: 'match', matchId: 1, slot: 'winner' }, status: 'done', winner: 'T1' },
      { id: 3, stage: 'GF', isChampionMatch: true, teamA: { type: 'match', matchId: 2, slot: 'winner' }, teamB: { type: 'match', matchId: 2, slot: 'loser' }, status: 'done', winner: 'T1' },
    ],
  });
  const stats = buildPlayerStats([tournament], 'b');
  assert.strictEqual(stats.wins, 0, '全败时胜场为 0');
  assert.strictEqual(stats.losses, 3, '全败时负场');
  assert.strictEqual(stats.winRate, 0, '全败时胜率');
  assert.strictEqual(stats.currentStreak, 0, '全败无连胜');
  assert.strictEqual(stats.runnerUps, 1, '亚军数');
  assert.strictEqual(stats.placements[0].rank, 2, '亚军名次');
}

/* 未产生冠军（总决赛未打完）：不计名次，但已完成的场次照常统计 */
function testUnfinished() {
  const tournament = twoTeamTournament({
    _id: 't4',
    createdAt: 4000,
    matches: [
      { id: 1, stage: 'UB1', teamA: teamSource(0, '战神队'), teamB: teamSource(1, '梦之队'), status: 'done', winner: 'T0' },
      { id: 2, stage: 'LB1', teamA: { type: 'match', matchId: 1, slot: 'winner' }, teamB: { type: 'match', matchId: 1, slot: 'loser' }, status: 'ready' },
      { id: 3, stage: 'GF', isChampionMatch: true, teamA: { type: 'match', matchId: 2, slot: 'winner' }, teamB: { type: 'match', matchId: 2, slot: 'loser' }, status: 'ready' },
    ],
  });
  const stats = buildPlayerStats([tournament], 'b');
  assert.strictEqual(stats.placements.length, 0, '未完赛不计名次');
  assert.strictEqual(stats.matches, 1, '已完成的比赛仍统计');
  assert.strictEqual(stats.wins, 1, '已完成的胜利仍统计');
  assert.strictEqual(stats.settledTournaments, 0, '未完赛不算已结算');
}

/* 只报名替补、没进队伍：不产生战绩，也不报错 */
function testNoTeam() {
  const stats = buildPlayerStats([twoTeamTournament()], 'nobody');
  assert.strictEqual(stats.registered, 1, '报名次数照算');
  assert.strictEqual(stats.playedTournaments, 0, '没上场');
  assert.strictEqual(stats.matches, 0, '没有比赛');
  assert.strictEqual(stats.winRate, 0, '胜率不出现 NaN');
}

/* 跨赛事连胜：先输后赢，最佳连胜按场次连续累计 */
function testCrossTournamentStreak() {
  const lose = twoTeamTournament({
    _id: 'lose',
    createdAt: 100,
    matches: [
      { id: 1, stage: 'UB1', teamA: teamSource(0, '战神队'), teamB: teamSource(1, '梦之队'), status: 'done', winner: 'T1' },
      { id: 2, stage: 'LB1', teamA: { type: 'match', matchId: 1, slot: 'winner' }, teamB: { type: 'match', matchId: 1, slot: 'loser' }, status: 'done', winner: 'T1' },
      { id: 3, stage: 'GF', isChampionMatch: true, teamA: { type: 'match', matchId: 2, slot: 'winner' }, teamB: { type: 'match', matchId: 2, slot: 'loser' }, status: 'done', winner: 'T1' },
    ],
  });
  const win = twoTeamTournament({ _id: 'win', createdAt: 200 });
  const stats = buildPlayerStats([win, lose], 'b');
  assert.strictEqual(stats.matches, 6, '两场赛事合计 6 场');
  assert.strictEqual(stats.wins, 3, '合计胜场');
  assert.strictEqual(stats.losses, 3, '合计负场');
  assert.strictEqual(stats.bestStreak, 3, '最佳连胜取最好的一段');
  assert.strictEqual(stats.currentStreak, 3, '当前连胜按最近一段');
  assert.strictEqual(stats.placements.length, 2, '两条名次记录');
  assert.ok(stats.placements[0].date > stats.placements[1].date, '名次按时间倒序');
}

testChampionStats();
testSeedingReverse();
testLossAndStreak();
testUnfinished();
testNoTeam();
testCrossTournamentStreak();
console.log('player stats tests passed.');
