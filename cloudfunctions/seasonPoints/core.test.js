const assert = require('assert');
const { buildBracket, buildSingleElimination, buildSingleRankBracket } = require('../dota2/bracket');
const { calculateStandings } = require('./standings');
const {
  SEASONS,
  getSeasonByTimestamp,
  unitsForRank,
  nextSettleRange,
  buildSettlementPlan,
  applyLedgerEntry,
} = require('./core');

function resolveMatches(matches) {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const winners = {};
  const losers = {};
  const resolveSource = (source) => {
    if (!source) return null;
    if (source.type === 'team') return { openid: source.openid, name: source.name };
    return (source.slot === 'winner' ? winners : losers)[source.matchId] || null;
  };
  return matches.map((match) => {
    const teamAInfo = resolveSource(match.teamA);
    const teamBInfo = resolveSource(match.teamB);
    const winner = teamAInfo;
    if (!winner || !teamBInfo) throw new Error('test fixture bracket did not resolve');
    winners[match.id] = winner;
    losers[match.id] = teamBInfo;
    const resolved = Object.assign({}, match, { teamAInfo, teamBInfo, winner: winner.openid, status: 'done' });
    byId.set(match.id, resolved);
    return resolved;
  });
}

function makeTournament(teamCount, singleElimination) {
  const source = Array.from({ length: teamCount }, (_, index) => ({ openid: 'T' + index, name: 'Team ' + index }));
  const matches = singleElimination ? buildSingleElimination(source) : buildBracket(source);
  const resolvedMatches = resolveMatches(matches);
  const teams = source.map((team, index) => ({
    captain: { openid: 'captain-' + index, nickname: team.name + ' captain', mmr: 5000 + index },
    players: [{ openid: 'player-' + index, nickname: team.name + ' player', mmr: 4000 + index }],
  }));
  const finalMatch = resolvedMatches.find((match) => match.isChampionMatch);
  const tournament = {
    _id: 'tournament-' + teamCount + (singleElimination ? '-single' : '-double'),
    name: 'Test Tournament',
    N: teamCount,
    status: 'finished',
    archivedAt: Date.parse('2026-11-08T12:00:00+08:00'),
    champion: finalMatch && finalMatch.teamAInfo,
    teams,
    matches,
    bracketType: singleElimination ? 'single' : 'double',
  };
  const standings = calculateStandings(tournament, resolvedMatches, teams);
  return { tournament, standings, resolvedMatches };
}

function makeSingleRankTournament(teamCount) {
  const source = Array.from({ length: teamCount }, (_, index) => ({ openid: 'T' + index, name: 'Team ' + index }));
  const matches = resolveMatches(buildSingleRankBracket(source));
  const teams = source.map((team, index) => ({
    captain: { openid: 'captain-' + index, nickname: team.name + ' captain', mmr: 5000 + index },
    players: [{ openid: 'player-' + index, nickname: team.name + ' player', mmr: 4000 + index }],
  }));
  const finalMatch = matches.find((match) => match.isChampionMatch);
  const tournament = {
    _id: 'tournament-single-rank-' + teamCount,
    name: 'Test Tournament',
    N: teamCount,
    status: 'finished',
    archivedAt: Date.parse('2026-11-08T12:00:00+08:00'),
    champion: finalMatch && finalMatch.teamAInfo,
    teams,
    matches,
    bracketType: 'singleRank',
  };
  const standings = calculateStandings(tournament, matches, teams);
  return { tournament, standings, resolvedMatches: matches };
}

function createFakeDb() {
  const state = { seasonPointLedger: new Map(), seasonAccounts: new Map() };
  return {
    state,
    async runTransaction(callback) {
      const transaction = {
        collection(name) {
          return {
            doc(id) {
              return {
                async get() {
                  const value = state[name].get(id);
                  if (!value) {
                    const error = new Error('document not found');
                    error.errCode = 'DATABASE_DOCUMENT_NOT_EXIST';
                    throw error;
                  }
                  return { data: Object.assign({}, value) };
                },
                async set({ data }) { state[name].set(id, Object.assign({}, data)); },
                async update({ data }) { state[name].set(id, Object.assign({}, state[name].get(id), data)); },
              };
            },
          };
        },
      };
      return callback(transaction);
    },
  };
}

async function main() {
  assert.strictEqual(SEASONS.length, 4);
  assert.strictEqual(getSeasonByTimestamp(SEASONS[0].startAt).seasonId, '2026Q1');
  assert.strictEqual(getSeasonByTimestamp(SEASONS[0].endAt).seasonId, '2026Q2');
  assert.strictEqual(getSeasonByTimestamp(SEASONS[3].endAt), null);

  for (const teamCount of [4, 8, 16]) {
    const planData = makeTournament(teamCount, false);
    const plan = buildSettlementPlan(planData.tournament, planData.standings, { now: 100 });
    assert.strictEqual(plan.seasonId, '2026Q4');
    assert.strictEqual(plan.teamCount, teamCount);
    assert.strictEqual(plan.participantCount, teamCount * 2);
    assert.strictEqual(plan.expectedNetUnits, 0);
    assert.strictEqual(plan.entries.reduce((sum, entry) => sum + entry.deltaUnits, 0), 0);
  }

  const fourTeamSingle = makeTournament(4, true);
  const singlePlan = buildSettlementPlan(fourTeamSingle.tournament, fourTeamSingle.standings);
  assert.strictEqual(singlePlan.entries.filter((entry) => entry.rank === 3 || entry.rank === 4).length, 4);
  assert(singlePlan.entries.filter((entry) => entry.rank === 3 || entry.rank === 4).every((entry) => entry.deltaUnits === -50));
  assert.strictEqual(unitsForRank(8, 4), 60);
  assert.strictEqual(unitsForRank(16, 3), 115);
  assert.strictEqual(unitsForRank(16, 5), -55);

  const invalidRankData = makeTournament(4, false);
  const duplicateChampionRank = Object.assign({}, invalidRankData.standings, {
    items: invalidRankData.standings.items.map((item, index) => Object.assign({}, item, { rank: index < 2 ? 1 : item.rank })),
  });
  assert.throws(() => buildSettlementPlan(invalidRankData.tournament, duplicateChampionRank), (error) => {
    assert.strictEqual(error.code, 'INVALID_STANDINGS');
    return true;
  });
  const mismatchedChampion = Object.assign({}, invalidRankData.tournament, { champion: { openid: 'not-the-winner' } });
  assert.throws(() => buildSettlementPlan(mismatchedChampion, invalidRankData.standings), (error) => {
    assert.strictEqual(error.code, 'INVALID_STANDINGS');
    return true;
  });
  const nullableMmrStandings = Object.assign({}, invalidRankData.standings, {
    items: invalidRankData.standings.items.map((item, itemIndex) => itemIndex === 0
      ? Object.assign({}, item, { members: item.members.map((member, memberIndex) => memberIndex === 0 ? Object.assign({}, member, { mmr: null }) : member) })
      : item),
  });
  const nullableMmrPlan = buildSettlementPlan(invalidRankData.tournament, nullableMmrStandings);
  assert.strictEqual(nullableMmrPlan.entries.find((entry) => entry.openid === 'captain-0').mmr, null);

  const unsupported = makeTournament(6, false);
  assert.throws(() => buildSettlementPlan(unsupported.tournament, unsupported.standings), (error) => {
    assert.match(error.message, /仅支持 4、8、16/);
    assert.strictEqual(error.code, 'UNSUPPORTED_TEAM_COUNT');
    return true;
  });

  const unevenData = makeTournament(4, false);
  unevenData.tournament.teams[0].players = [];
  const unevenStandings = calculateStandings(unevenData.tournament, unevenData.resolvedMatches, unevenData.tournament.teams);
  assert.throws(() => buildSettlementPlan(unevenData.tournament, unevenStandings), (error) => {
    assert.match(error.message, /参赛人数不一致/);
    assert.strictEqual(error.code, 'ROSTER_MISMATCH');
    return true;
  });

  // 单败排位赛分表：3/4/5/6 名各自独立，且整场净额仍为 0
  assert.strictEqual(unitsForRank(8, 3, 'singleRank'), 80);
  assert.strictEqual(unitsForRank(8, 4, 'singleRank'), 40);
  assert.strictEqual(unitsForRank(8, 5, 'singleRank'), -100);
  assert.strictEqual(unitsForRank(8, 6, 'singleRank'), -120);
  assert.strictEqual(unitsForRank(16, 9, 'singleRank'), -58);
  assert.strictEqual(unitsForRank(16, 10, 'singleRank'), -62);
  // 双败 / 单败仍走原来的四档表，不受新赛制影响
  assert.strictEqual(unitsForRank(8, 3, 'double'), 60);
  assert.strictEqual(unitsForRank(8, 4, 'single'), 60);

  const singleRankExpectedUnits = {
    4: { 1: 90, 2: 10, 3: -40, 4: -60 },
    8: { 1: 200, 2: 120, 3: 80, 4: 40, 5: -100, 6: -120 },
    16: { 1: 255, 2: 175, 3: 130, 4: 100, 5: -40, 6: -50, 9: -58, 10: -62 },
  };
  Object.keys(singleRankExpectedUnits).forEach((key) => {
    const teamCount = Number(key);
    const data = makeSingleRankTournament(teamCount);
    assert(data.standings.complete, teamCount + ' 队单败排位赛应能算完整名次');
    const plan = buildSettlementPlan(data.tournament, data.standings, { now: 100 });
    assert.strictEqual(plan.expectedNetUnits, 0, teamCount + ' 队单败排位赛净额必须为 0');
    // 每队 1 名队长 + 1 名队员 → 每条名次各 2 条流水，且同一名次的分值必须一致
    const unitsByRank = {};
    plan.entries.forEach((entry) => {
      assert.strictEqual(
        unitsByRank[entry.rank] === undefined ? entry.deltaUnits : unitsByRank[entry.rank],
        entry.deltaUnits,
        teamCount + ' 队第' + entry.rank + '名分值不一致'
      );
      unitsByRank[entry.rank] = entry.deltaUnits;
    });
    assert.deepStrictEqual(unitsByRank, singleRankExpectedUnits[teamCount], teamCount + ' 队单败排位赛分值不符合约定表');
    assert.strictEqual(plan.entries.length, teamCount * 2);
  });

  const db = createFakeDb();
  const entry = {
    entryId: 'ledger-1', seasonId: '2026Q4', openid: 'player-1', deltaUnits: 90,
    nickname: 'Player', mmr: 4000,
  };
  assert.deepStrictEqual(await applyLedgerEntry(db, entry, 'account-1'), { applied: true, duplicate: false });
  assert.deepStrictEqual(await applyLedgerEntry(db, entry, 'account-1'), { applied: false, duplicate: true });
  assert.strictEqual(db.state.seasonAccounts.get('account-1').balanceUnits, 90);
  assert.strictEqual(db.state.seasonAccounts.get('account-1').settledMatches, 1);
  assert.strictEqual(db.state.seasonPointLedger.size, 1);

  // 分批结算区间：32 人、每批 6 条 → 6 次写完，最后一批越界自动收敛
  assert.deepStrictEqual(nextSettleRange(32, 0, 6), { start: 0, end: 6, done: false });
  assert.deepStrictEqual(nextSettleRange(32, 6, 6), { start: 6, end: 12, done: false });
  assert.deepStrictEqual(nextSettleRange(32, 30, 6), { start: 30, end: 32, done: false });
  assert.deepStrictEqual(nextSettleRange(32, 32, 6), { start: 32, end: 32, done: true });
  assert.deepStrictEqual(nextSettleRange(0, 0, 6), { start: 0, end: 0, done: true });
  assert.deepStrictEqual(nextSettleRange(32, 40, 6), { start: 32, end: 32, done: true });
  assert.deepStrictEqual(nextSettleRange(32, 5, 0), { start: 5, end: 6, done: false });
  assert.deepStrictEqual(nextSettleRange(32, 33, 6), { start: 32, end: 32, done: true });
  console.log('Season points core tests passed for quarter boundaries, 4/8/16-team net-zero scoring, roster validation, idempotent ledger writes, and resumable settle ranges.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
