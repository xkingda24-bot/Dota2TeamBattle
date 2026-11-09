const assert = require('assert');
const { buildSingleRankBracket } = require('./bracket');
const { calculateStandings } = require('./standings');

function makeTeams(count) {
  return Array.from({ length: count }, (_, index) => ({
    openid: 'T' + index,
    name: '队伍 ' + (index + 1),
  }));
}

/* 按构造顺序打完全部比赛（固定 A 位获胜），用于验证名次计算 */
function playAll(teamCount, options) {
  const skipPlacement = (options && options.skipPlacement) || 0;
  const sourceTeams = makeTeams(teamCount);
  const teams = sourceTeams.map((team) => ({
    captain: { openid: team.openid, nickname: team.name },
    players: [],
  }));
  const matches = buildSingleRankBracket(sourceTeams);
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

  let skipped = 0;
  matches.forEach((match) => {
    match.teamAInfo = resolve(match.teamA);
    match.teamBInfo = resolve(match.teamB);
    assert(match.teamAInfo && match.teamBInfo, '赛程不能出现半边空位（stage=' + match.stage + '）');
    if (match.isPlacementMatch && skipped < skipPlacement) {
      skipped += 1;
      return; // 留作未打完的名次赛
    }
    match.winner = match.teamAInfo.openid;
    match.status = 'done';
  });

  return {
    tournament: { N: teamCount, teams, matches, status: 'finished', bracketType: 'singleRank' },
    matches,
  };
}

/* ---------- 1. 赛程结构：场次数、名次赛接线 ---------- */
const EXPECTED_COUNTS = { 4: 4, 8: 10, 16: 22 };
[4, 8, 16].forEach((teamCount) => {
  const matches = buildSingleRankBracket(makeTeams(teamCount));

  // 单败排位赛 = 单败 (N-1 场) + 名次赛
  assert.strictEqual(matches.length, EXPECTED_COUNTS[teamCount], teamCount + ' 队场次数不对');
  const main = matches.filter((match) => !match.isPlacementMatch);
  assert.strictEqual(main.length, teamCount - 1, teamCount + ' 队主赛程应恒为 N-1 场');
  assert.strictEqual(main.filter((match) => match.isChampionMatch).length, 1, '只应有一场冠军赛');

  // 主赛程仍是单败：只有 UB 轮次 + GF，且没有败者组
  assert(
    main.every((match) => /^(UB\d+|GF)$/.test(match.stage || '')),
    teamCount + ' 队主赛程 stage 异常：' + main.map((m) => m.stage).join(',')
  );

  // 名次赛：stage = P + 胜者名次 + 败者名次，两档名次必须相邻
  const placements = matches.filter((match) => match.isPlacementMatch);
  placements.forEach((match) => {
    assert(match.placement && match.placement.winRank && match.placement.loseRank, '名次赛必须带 placement');
    assert.strictEqual(match.placement.loseRank, match.placement.winRank + 1, '名次赛两档名次必须相邻');
    assert.strictEqual(match.stage, 'P' + match.placement.winRank + match.placement.loseRank);
    assert.strictEqual(match.isChampionMatch, false);
    assert.strictEqual(match.next, null, '名次赛是终点，不应再晋级');
    // 名次赛的双方都来自上游败者
    assert(match.teamA && match.teamA.type === 'match' && match.teamA.slot === 'loser');
    assert(match.teamB && match.teamB.type === 'match' && match.teamB.slot === 'loser');
  });

  // 名次覆盖：冠军+亚军 2 人，其余每档恰好是名次赛的两倍人数
  const rankedSeats = placements.reduce((sum, match) => sum + 2, 0) + 2;
  assert.strictEqual(rankedSeats, teamCount, teamCount + ' 队名次席位应正好覆盖全员');
});

// 4 队：半决赛败者打三四名决赛
{
  const matches = buildSingleRankBracket(makeTeams(4));
  assert.deepStrictEqual(matches.map((m) => m.stage), ['UB1', 'UB1', 'GF', 'P34']);
  assert.strictEqual(matches[3].label, '三四名决赛');
  assert.deepStrictEqual(matches[3].placement, { winRank: 3, loseRank: 4 });
}

// 8 队：半决赛败者打三四名决赛；首轮败者两两打 5-6 名排位
{
  const matches = buildSingleRankBracket(makeTeams(8));
  assert.deepStrictEqual(
    matches.map((m) => m.stage),
    ['UB1', 'UB1', 'UB1', 'UB1', 'UB2', 'UB2', 'GF', 'P34', 'P56', 'P56']
  );
  assert.deepStrictEqual(
    matches.map((m) => m.label),
    ['第一轮', '第一轮', '第一轮', '第一轮', '半决赛', '半决赛', '总决赛', '三四名决赛', '5-6 名排位', '5-6 名排位']
  );
  const semis = matches.filter((m) => m.stage === 'UB2');
  const p34 = matches.find((m) => m.stage === 'P34');
  // P34 的两侧就是两场半决赛的败者，且半决赛记录 loserNext 指向它
  assert.strictEqual(p34.teamA.matchId, semis[0].id);
  assert.strictEqual(p34.teamB.matchId, semis[1].id);
  assert.deepStrictEqual(semis[0].loserNext, { matchId: p34.id, slot: 'A' });
  assert.deepStrictEqual(semis[1].loserNext, { matchId: p34.id, slot: 'B' });
  // 5-6 名排位：首轮相邻两场的败者配对（第1场败者 vs 第2场败者、第3场 vs 第4场）
  const firstRound = matches.filter((m) => m.stage === 'UB1');
  const p56 = matches.filter((m) => m.stage === 'P56');
  assert.strictEqual(p56[0].teamA.matchId, firstRound[0].id);
  assert.strictEqual(p56[0].teamB.matchId, firstRound[1].id);
  assert.strictEqual(p56[1].teamA.matchId, firstRound[2].id);
  assert.strictEqual(p56[1].teamB.matchId, firstRound[3].id);
  assert.deepStrictEqual(p56[0].placement, { winRank: 5, loseRank: 6 });
}

// 16 队：半决赛 -> P34、四分之一决赛 -> P56、首轮 -> P910（4 场）
{
  const matches = buildSingleRankBracket(makeTeams(16));
  const stages = matches.reduce((map, match) => {
    map[match.stage] = (map[match.stage] || 0) + 1;
    return map;
  }, {});
  assert.strictEqual(stages.P34, 1);
  assert.strictEqual(stages.P56, 2);
  assert.strictEqual(stages.P910, 4);
  assert.strictEqual(matches.length, 22);
  const p910 = matches.find((m) => m.stage === 'P910');
  assert.deepStrictEqual(p910.placement, { winRank: 9, loseRank: 10 });
  assert.strictEqual(p910.label, '9-10 名排位');
}

assert.throws(() => buildSingleRankBracket([{ openid: 'T0', name: '独苗' }]), /至少 2 支队伍/);

/* ---------- 2. 赛果 -> 名次 ---------- */
{
  const { tournament, matches } = playAll(4);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert(result.complete, '4 队打完全部比赛应可结算');
  assert.deepStrictEqual(result.items.map((item) => item.label), ['冠军', '亚军', '季军', '第4名']);
  assert.deepStrictEqual(result.items.map((item) => item.rank), [1, 2, 3, 4]);
}

{
  const { tournament, matches } = playAll(8);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert(result.complete, '8 队打完全部比赛应可结算');
  assert.deepStrictEqual(result.items.map((item) => item.rank), [1, 2, 3, 4, 5, 5, 6, 6]);
  assert.deepStrictEqual(
    result.items.map((item) => item.label),
    ['冠军', '亚军', '季军', '第4名', '第5名（并列）', '第5名（并列）', '第6名（并列）', '第6名（并列）']
  );
  assert.strictEqual(new Set(result.items.map((item) => item.teamId)).size, 8);
  assert(!result.items.some((item) => item.label === '名次待核实'));
}

{
  const { tournament, matches } = playAll(16);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert(result.complete, '16 队打完全部比赛应可结算');
  assert.deepStrictEqual(result.items.map((item) => item.rank), [1, 2, 3, 4, 5, 5, 6, 6, 9, 9, 9, 9, 10, 10, 10, 10]);
  assert.deepStrictEqual(
    result.items.slice(4).map((item) => item.label),
    ['第5名（并列）', '第5名（并列）', '第6名（并列）', '第6名（并列）',
      '第9名（并列）', '第9名（并列）', '第9名（并列）', '第9名（并列）',
      '第10名（并列）', '第10名（并列）', '第10名（并列）', '第10名（并列）']
  );
}

/* ---------- 3. 名次赛没打完时不能算完整 ---------- */
{
  const { tournament, matches } = playAll(8, { skipPlacement: 1 });
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert.strictEqual(result.complete, false, '名次赛未打完时 standings 必须标记不完整');
  const pending = matches.filter((match) => match.isPlacementMatch && match.status !== 'done');
  assert.strictEqual(pending.length, 1);
  // 没打完的那档名次不能凭空给出
  const pendingRanks = result.items.filter((item) => item.rank == null);
  assert.strictEqual(pendingRanks.length, 2, '未打完的名次赛对应的两支队伍应标为名次待核实');
}

// 单败排位赛同样支持人工调整名次顺序（人工顺序优先）
{
  const { tournament, matches } = playAll(8);
  const auto = calculateStandings(tournament, matches, tournament.teams);
  const reverseOrder = auto.items.map((item) => item.teamId).reverse();
  const manual = calculateStandings(
    Object.assign({}, tournament, { standingsOrder: reverseOrder }),
    matches,
    tournament.teams
  );
  assert.strictEqual(manual.items[0].teamId, reverseOrder[0]);
  assert.strictEqual(manual.items[0].label, '冠军');
}

console.log('bracket-single-rank.test.js passed');
