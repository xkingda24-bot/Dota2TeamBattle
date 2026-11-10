const assert = require('assert');
const { buildPick8Bracket } = require('./bracket');
const { calculateStandings } = require('./standings');

function makeTeams(count) {
  return Array.from({ length: count }, (_, index) => ({
    openid: 'T' + index,
    name: '队伍 ' + (index + 1),
  }));
}

/* 按构造顺序打完全部比赛（固定 A 位获胜），可选留一场打完三四名决赛之前的状态 */
function playAll(options) {
  const skipThirdPlace = !!(options && options.skipThirdPlace);
  const sourceTeams = makeTeams(8);
  const teams = sourceTeams.map((team) => ({
    captain: { openid: team.openid, nickname: team.name },
    players: [],
  }));
  const matches = buildPick8Bracket(sourceTeams);
  const matchesById = new Map(matches.map((match) => [match.id, match]));

  function resolve(source) {
    if (!source) return null;
    if (source.type === 'team') return { openid: source.openid, name: source.name };
    const feeder = matchesById.get(source.matchId);
    assert(feeder && feeder.status === 'done', '上游比赛必须已打完');
    const winner = feeder.teamAInfo.openid === feeder.winner ? feeder.teamAInfo : feeder.teamBInfo;
    const loser = feeder.teamAInfo.openid === feeder.winner ? feeder.teamBInfo : feeder.teamAInfo;
    return source.slot === 'winner' ? winner : loser;
  }

  matches.forEach((match) => {
    match.teamAInfo = resolve(match.teamA);
    match.teamBInfo = resolve(match.teamB);
    assert(match.teamAInfo && match.teamBInfo, '赛程不能出现半边空位（stage=' + match.stage + '）');
    if (match.isPlacementMatch && skipThirdPlace) return;
    match.winner = match.teamAInfo.openid;
    match.status = 'done';
  });

  return {
    tournament: { N: 8, teams, matches, status: 'finished', bracketType: 'pick8' },
    matches,
  };
}

/* ---------- 1. 赛程结构 ---------- */
const matches = buildPick8Bracket(makeTeams(8));
assert.strictEqual(matches.length, 12, '8 队挑选赛应为 4+4+2+1+1=12 场');
assert.throws(() => buildPick8Bracket(makeTeams(4)), /8 支队伍/i, '非 8 队必须拒绝生成');

const byStage = {};
matches.forEach((match) => {
  byStage[match.stage] = (byStage[match.stage] || []).concat([match]);
});
assert.strictEqual(byStage.UB1.length, 4);
assert.strictEqual(byStage.UB2.length, 4);
assert.strictEqual(byStage.UB3.length, 2);
assert.strictEqual(byStage.GF.length, 1);
assert.strictEqual(byStage.P34.length, 1);

// 第一轮：相邻两两配对，败者不淘汰（loserNext 指向第二轮）
const firstRound = byStage.UB1;
firstRound.forEach((match) => {
  assert(match.teamA.type === 'team' && match.teamB.type === 'team');
  assert(match.loserNext && match.loserNext.matchId, '第一轮败者必须进入第二轮');
  assert(match.next && match.next.matchId, '第一轮胜者必须进入第二轮');
});

// 第二轮：固定交叉（W(1v2) vs L(3v4)、W(3v4) vs L(1v2)，5-8 同理）
const secondRound = byStage.UB2;
for (let group = 0; group < 4; group += 2) {
  const first = firstRound[group];
  const next = firstRound[group + 1];
  const crossA = secondRound[group];
  const crossB = secondRound[group + 1];
  assert.strictEqual(crossA.teamA.matchId, first.id);
  assert.strictEqual(crossA.teamA.slot, 'winner');
  assert.strictEqual(crossA.teamB.matchId, next.id);
  assert.strictEqual(crossA.teamB.slot, 'loser');
  assert.strictEqual(crossB.teamA.matchId, next.id);
  assert.strictEqual(crossB.teamA.slot, 'winner');
  assert.strictEqual(crossB.teamB.matchId, first.id);
  assert.strictEqual(crossB.teamB.slot, 'loser');
  // 第二轮败者直接淘汰
  assert.strictEqual(crossA.loserNext, null);
  assert.strictEqual(crossB.loserNext, null);
}

// 第三轮同半区：1、2 场胜者互打；3、4 场胜者互打
assert.strictEqual(byStage.UB3[0].teamA.matchId, secondRound[0].id);
assert.strictEqual(byStage.UB3[0].teamB.matchId, secondRound[1].id);
assert.strictEqual(byStage.UB3[1].teamA.matchId, secondRound[2].id);
assert.strictEqual(byStage.UB3[1].teamB.matchId, secondRound[3].id);

// 第四轮：总决赛 + 三四名决赛（两个半决赛败者）
const gf = byStage.GF[0];
assert.strictEqual(gf.isChampionMatch, true);
assert.strictEqual(gf.teamA.matchId, byStage.UB3[0].id);
assert.strictEqual(gf.teamA.slot, 'winner');
assert.strictEqual(gf.teamB.matchId, byStage.UB3[1].id);
const thirdPlace = byStage.P34[0];
assert.strictEqual(thirdPlace.isPlacementMatch, true);
assert.deepStrictEqual(thirdPlace.placement, { winRank: 3, loseRank: 4 });
assert.strictEqual(thirdPlace.teamA.slot, 'loser');
assert.strictEqual(thirdPlace.teamB.slot, 'loser');

/* ---------- 2. 名次计算：1/2、3/4、5-8 并列 ---------- */
const played = playAll();
const standings = calculateStandings(played.tournament, played.matches, played.tournament.teams);
assert.strictEqual(standings.complete, true, '全部比赛打完后名次应完整');
assert.deepStrictEqual(
  standings.items.map((item) => item.rank).sort((a, b) => a - b),
  [1, 2, 3, 4, 5, 5, 5, 5],
);
assert.strictEqual(standings.items.find((item) => item.rank === 3).label, '季军');
assert.strictEqual(standings.items.find((item) => item.rank === 4).label, '第4名');
standings.items.filter((item) => item.rank === 5).forEach((item) => {
  assert.strictEqual(item.label, '第5-8名');
});

/* ---------- 3. 三四名决赛没打完时名次不完整 ---------- */
const unfinished = playAll({ skipThirdPlace: true });
const partial = calculateStandings(unfinished.tournament, unfinished.matches, unfinished.tournament.teams);
assert.strictEqual(partial.complete, false, '三四名决赛未打完时不能算完整名次');

console.log('Pick8 bracket tests passed for structure, cross pairing, same-half semifinals, tie 5-8 placement and third-place dependency.');
