const assert = require('assert');
const { buildBracket } = require('./bracket');
const { calculateStandings } = require('./standings');

function playBracket(teamCount) {
  const sourceTeams = Array.from({ length: teamCount }, (_, index) => ({
    openid: 'T' + index,
    name: '队伍 ' + (index + 1),
  }));
  const teams = sourceTeams.map((team) => ({
    captain: { openid: team.openid, nickname: team.name },
    players: [],
  }));
  const matches = buildBracket(sourceTeams);
  const matchesById = new Map(matches.map((match) => [match.id, match]));

  function resolve(source) {
    if (!source) return null;
    if (source.type === 'team') return { openid: source.openid, name: source.name };
    const feeder = matchesById.get(source.matchId);
    assert(feeder && feeder.status === 'done', 'bracket feeds must be resolved in build order');
    const winner = feeder.teamAInfo.openid === feeder.winner ? feeder.teamAInfo : feeder.teamBInfo;
    const loser = feeder.teamAInfo.openid === feeder.winner ? feeder.teamBInfo : feeder.teamAInfo;
    return source.slot === 'winner' ? winner : loser;
  }

  matches.forEach((match) => {
    match.teamAInfo = resolve(match.teamA);
    match.teamBInfo = resolve(match.teamB);
    assert(match.teamAInfo && match.teamBInfo, 'every generated match must have two teams');
    match.winner = match.id % 2 === 0 ? match.teamBInfo.openid : match.teamAInfo.openid;
    match.status = 'done';
  });

  return {
    tournament: { N: teamCount, teams, matches, status: 'finished' },
    matches,
  };
}

for (let teamCount = 2; teamCount <= 16; teamCount++) {
  const { tournament, matches } = playBracket(teamCount);
  const result = calculateStandings(tournament, matches, tournament.teams);

  assert(result && result.complete, teamCount + ' teams should receive complete standings');
  assert.strictEqual(result.items.length, teamCount);
  assert(result.items.every((item) => Number.isInteger(item.rank)));
  assert.strictEqual(new Set(result.items.map((item) => item.teamId)).size, teamCount);
  assert.strictEqual(result.items[0].label, '冠军');
  assert.strictEqual(result.items[1].label, '亚军');
  if (teamCount === 2) assert(!result.items.some((item) => item.label === '季军'));
  else assert.strictEqual(result.items[2].label, '季军');

  const reverseOrder = result.items.map((item) => item.teamId).reverse();
  const manuallyOrdered = calculateStandings(
    Object.assign({}, tournament, { standingsOrder: reverseOrder }),
    matches,
    tournament.teams
  );
  assert.deepStrictEqual(manuallyOrdered.items.map((item) => item.teamId), reverseOrder);
  assert.deepStrictEqual(manuallyOrdered.items.map((item) => item.rank), reverseOrder.map((_, index) => index + 1));
}

const incomplete = playBracket(4);
const finalMatch = incomplete.matches.find((match) => match.isChampionMatch);
finalMatch.status = 'pending';
assert.strictEqual(calculateStandings(incomplete.tournament, incomplete.matches, incomplete.tournament.teams), null);

console.log('Standings tests passed for 2-16 teams, manual order, and incomplete finals.');
