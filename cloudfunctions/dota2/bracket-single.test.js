const assert = require('assert');
const { buildSingleElimination, buildBracket, resolveSeeding, orderTeamsBySeeding } = require('./bracket');
const { calculateStandings } = require('./standings');

function makeTeams(count) {
  return Array.from({ length: count }, (_, index) => ({
    openid: 'T' + index,
    name: '队伍 ' + (index + 1),
  }));
}

/* 按构造顺序打完全部比赛（固定 A 位获胜），用于验证名次计算 */
function playSingle(teamCount) {
  const sourceTeams = makeTeams(teamCount);
  const teams = sourceTeams.map((team) => ({
    captain: { openid: team.openid, nickname: team.name },
    players: [],
  }));
  const matches = buildSingleElimination(sourceTeams);
  const matchesById = new Map(matches.map((match) => [match.id, match]));

  function resolve(source) {
    if (!source) return null;
    if (source.type === 'team') return { openid: source.openid, name: source.name };
    const feeder = matchesById.get(source.matchId);
    assert(feeder && feeder.status === 'done', '单败赛程必须按构造顺序解析上游比赛');
    const winner = feeder.teamAInfo.openid === feeder.winner ? feeder.teamAInfo : feeder.teamBInfo;
    const loser = feeder.teamAInfo.openid === feeder.winner ? feeder.teamBInfo : feeder.teamAInfo;
    return source.slot === 'winner' ? winner : loser;
  }

  matches.forEach((match) => {
    match.teamAInfo = resolve(match.teamA);
    match.teamBInfo = resolve(match.teamB);
    assert(match.teamAInfo && match.teamBInfo, '单败赛程不能出现半边空位');
    match.winner = match.teamAInfo.openid;
    match.status = 'done';
  });

  return {
    tournament: { N: teamCount, teams, matches, status: 'finished', bracketType: 'single' },
    matches,
  };
}

/* ---------- 1. 赛程结构 ---------- */
[2, 3, 4, 5, 6, 7, 8, 11, 16].forEach((teamCount) => {
  const teams = makeTeams(teamCount);
  const matches = buildSingleElimination(teams);

  // 每场淘汰一支队伍，因此场次恒等于 N-1（没有三四名决赛与排位赛）
  assert.strictEqual(matches.length, teamCount - 1, teamCount + ' 队应有 N-1 场');

  // 单败不产生败者组，也没有败者去向
  assert(
    matches.every((match) => !/^LB/i.test(match.stage || '')),
    teamCount + ' 队不应生成败者组比赛'
  );
  assert(
    matches.every((match) => match.loserNext === null),
    teamCount + ' 队的 loserNext 必须全部为空'
  );

  // stage 只有 UB 轮次与总决赛，且只剩一场冠军赛
  assert(
    matches.every((match) => /^(UB\d+|GF)$/.test(match.stage || '')),
    teamCount + ' 队出现了非法 stage：' + matches.map((m) => m.stage).join(',')
  );
  const finals = matches.filter((match) => match.isChampionMatch);
  assert.strictEqual(finals.length, 1, teamCount + ' 队应只有一场冠军赛');
  assert.strictEqual(finals[0].stage, 'GF');
  assert.strictEqual(finals[0].label, '总决赛');

  // 每支队伍只在首轮出现一次（轮空队伍不出现在任何比赛里，直接进入下一轮）
  const seeds = matches
    .map((match) => [match.teamA, match.teamB])
    .reduce((list, pair) => list.concat(pair), [])
    .filter((source) => source && source.type === 'team');
  const seedIds = new Set(seeds.map((source) => source.openid));
  assert(seedIds.size >= 2, teamCount + ' 队应至少落位 2 支种子');

  // 轮次文案：总决赛 + 半决赛 + 第 N 轮
  assert(
    matches.every((match) => match.label === '总决赛' || match.label === '半决赛' || /^第[一二三四五六七八九十]+轮$/.test(match.label)),
    teamCount + ' 队轮次文案异常：' + matches.map((m) => m.label).join(',')
  );

  if (teamCount === 4) {
    assert.deepStrictEqual(matches.map((m) => m.stage), ['UB1', 'UB1', 'GF']);
    assert.deepStrictEqual(matches.map((m) => m.label), ['半决赛', '半决赛', '总决赛']);
  }
  if (teamCount === 8) {
    assert.deepStrictEqual(matches.map((m) => m.label), ['第一轮', '第一轮', '第一轮', '第一轮', '半决赛', '半决赛', '总决赛']);
  }
});

assert.throws(() => buildSingleElimination([{ openid: 'T0', name: '独苗' }]), /至少 2 支队伍/);

/* ---------- 2. 赛程结果 -> 名次 ---------- */
for (let teamCount = 2; teamCount <= 16; teamCount++) {
  const { tournament, matches } = playSingle(teamCount);
  const result = calculateStandings(tournament, matches, tournament.teams);

  assert(result && result.complete, teamCount + ' 队单败赛果应能完整结算（不依赖败者组决赛）');
  assert.strictEqual(result.items.length, teamCount);
  assert(result.items.every((item) => Number.isInteger(item.rank)), teamCount + ' 队应全员有名次');
  assert.strictEqual(new Set(result.items.map((item) => item.teamId)).size, teamCount);
  assert.strictEqual(result.items[0].label, '冠军');
  assert.strictEqual(result.items[1].label, '亚军');
  // 单败不设三四名决赛，不能出现单独的"季军"
  assert(!result.items.some((item) => item.label === '季军'), teamCount + ' 队不应产生季军');
  assert(!result.items.some((item) => item.label === '名次待核实'), teamCount + ' 队不应有名次待核实');
}

// 4 队：半决赛败者共享第 3-4 名
{
  const { tournament, matches } = playSingle(4);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert.strictEqual(result.items[2].label, '第3-4名');
  assert.strictEqual(result.items[3].label, '第3-4名');
  assert.strictEqual(result.items[2].rank, 3);
}

// 8 队：半决赛败者 3-4 名，首轮败者 5-8 名
{
  const { tournament, matches } = playSingle(8);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert.deepStrictEqual(
    result.items.map((item) => item.label),
    ['冠军', '亚军', '第3-4名', '第3-4名', '第5-8名', '第5-8名', '第5-8名', '第5-8名']
  );
}

// 3 队：首轮一场淘汰的即为第 3 名（无并列）
{
  const { tournament, matches } = playSingle(3);
  const result = calculateStandings(tournament, matches, tournament.teams);
  assert.strictEqual(result.items[2].label, '第3名');
}

// 单败同样支持人工调整名次顺序
{
  const { tournament, matches } = playSingle(6);
  const auto = calculateStandings(tournament, matches, tournament.teams);
  const reverseOrder = auto.items.map((item) => item.teamId).reverse();
  const manual = calculateStandings(
    Object.assign({}, tournament, { standingsOrder: reverseOrder }),
    matches,
    tournament.teams
  );
  assert.deepStrictEqual(manual.items.map((item) => item.teamId), reverseOrder);
}

// 总决赛未完成时不给名次
{
  const { tournament, matches } = playSingle(5);
  matches.find((match) => match.isChampionMatch).status = 'pending';
  assert.strictEqual(calculateStandings(tournament, matches, tournament.teams), null);
}

// 旧数据（无 bracketType）仍按双败处理，不能返回单败口径
{
  const { tournament, matches } = playSingle(8);
  const legacy = Object.assign({}, tournament, { bracketType: undefined });
  const result = calculateStandings(legacy, matches, legacy.teams);
  assert(result, '缺少 bracketType 时仍应按双败结算');
}

/* 落位解析：没有落位表时退回队伍原始顺序（系统分组按组号），不随机打乱 */
{
  const natural = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepStrictEqual(resolveSeeding(8, null), natural, '缺少落位表时应按队伍原始顺序');
  assert.deepStrictEqual(resolveSeeding(8, undefined), natural, '落位表为 undefined 时同样退回原始顺序');
  const manual = [3, 2, 1, 0, 7, 6, 5, 4];
  assert.deepStrictEqual(resolveSeeding(8, manual), manual, '合法落位表必须原样使用');
  assert.deepStrictEqual(resolveSeeding(8, [0, 0, 1, 2, 3, 4, 5, 6]), natural, '重复落位视为非法');
  assert.deepStrictEqual(resolveSeeding(8, [0, 1, 2]), natural, '长度不符视为非法');
  assert.deepStrictEqual(resolveSeeding(8, [0, 1, 2, 3, 4, 5, 6, 8]), natural, '越界落位视为非法');
}

/* 首轮配对顺序：从上到下 = 第1支打第2支、第3支打第4支…… 双败与单败口径一致 */
{
  const ordered = orderTeamsBySeeding(makeTeams(8), null);
  const expected = [
    ['队伍 1', '队伍 2'],
    ['队伍 3', '队伍 4'],
    ['队伍 5', '队伍 6'],
    ['队伍 7', '队伍 8'],
  ];
  const pairsOf = (matches) => matches
    .filter((match) => match.stage === 'UB1')
    .sort((a, b) => a.id - b.id)
    .map((match) => [match.teamA.name, match.teamB.name]);
  assert.deepStrictEqual(pairsOf(buildBracket(ordered)), expected, '双败首轮应按队伍顺序相邻配对');
  assert.deepStrictEqual(pairsOf(buildSingleElimination(ordered)), expected, '单败首轮应按队伍顺序相邻配对');
}

/* 奇数队伍：末位落位轮空，直接进入下一轮胜者组 */
{
  const matches = buildBracket(makeTeams(5));
  const firstRound = matches
    .filter((match) => match.stage === 'UB1')
    .sort((a, b) => a.id - b.id)
    .map((match) => [match.teamA.name, match.teamB.name]);
  assert.deepStrictEqual(firstRound, [['队伍 1', '队伍 2'], ['队伍 3', '队伍 4']], '5 支队伍时首轮只配两场');
  const byeSides = matches.filter((match) => ['A', 'B'].some((slot) => {
    const src = match['team' + slot];
    return src && src.type === 'team' && src.name === '队伍 5';
  }));
  assert.strictEqual(byeSides.length, 1, '队伍 5 只应出现在一场比赛里');
  assert.strictEqual(byeSides[0].stage, 'UBF', '末位落位轮空后应在胜者组决赛登场');
}

console.log('Single elimination bracket tests passed for structure, 2-16 teams standings, and single-format compatibility.');
