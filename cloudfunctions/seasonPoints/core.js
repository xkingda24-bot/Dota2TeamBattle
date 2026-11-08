const crypto = require('crypto');

const RULE_VERSION = 'points-v1';
const UNIT_SCALE = 2;
const SUPPORTED_TEAM_COUNTS = [4, 8, 16];

const SEASONS = [
  { seasonId: '2026Q1', label: '2026 Q1', startAt: Date.parse('2026-01-01T00:00:00+08:00'), endAt: Date.parse('2026-04-01T00:00:00+08:00') },
  { seasonId: '2026Q2', label: '2026 Q2', startAt: Date.parse('2026-04-01T00:00:00+08:00'), endAt: Date.parse('2026-07-01T00:00:00+08:00') },
  { seasonId: '2026Q3', label: '2026 Q3', startAt: Date.parse('2026-07-01T00:00:00+08:00'), endAt: Date.parse('2026-10-01T00:00:00+08:00') },
  { seasonId: '2026Q4', label: '2026 Q4', startAt: Date.parse('2026-10-01T00:00:00+08:00'), endAt: Date.parse('2027-01-01T00:00:00+08:00') },
];

const SCORE_UNITS = {
  4: { champion: 90, runnerUp: 10, thirdOrFourth: -50, other: null },
  8: { champion: 200, runnerUp: 120, thirdOrFourth: 60, other: -110 },
  16: { champion: 255, runnerUp: 175, thirdOrFourth: 115, other: -55 },
};

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getSeasonById(seasonId) {
  return SEASONS.find((season) => season.seasonId === seasonId) || null;
}

function getSeasonByTimestamp(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return null;
  return SEASONS.find((season) => value >= season.startAt && value < season.endAt) || null;
}

function defaultSeason(timestamp) {
  const current = getSeasonByTimestamp(timestamp);
  return current || SEASONS[SEASONS.length - 1];
}

function unitsForRank(teamCount, rank) {
  const rules = SCORE_UNITS[Number(teamCount)];
  const position = Number(rank);
  if (!rules || !Number.isInteger(position) || position < 1 || position > teamCount) return null;
  if (position === 1) return rules.champion;
  if (position === 2) return rules.runnerUp;
  if (position === 3 || position === 4) return rules.thirdOrFourth;
  return rules.other;
}

function validationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeOpenid(member) {
  if (typeof member === 'string') return member.trim();
  return String(member && member.openid || '').trim();
}

function fingerprintFor(tournament, standings) {
  const items = (standings.items || []).map((item) => ({
    teamId: String(item.teamId || ''),
    rank: item.rank == null ? null : Number(item.rank),
    label: String(item.label || ''),
    members: (item.members || []).map(normalizeOpenid).filter(Boolean).sort(),
  })).sort((a, b) => a.teamId.localeCompare(b.teamId));
  return sha256(JSON.stringify({
    tournamentId: String(tournament._id || tournament.id || ''),
    archivedAt: Number(tournament.archivedAt) || 0,
    teamCount: Number(tournament.N) || 0,
    standingsOrder: Array.isArray(tournament.standingsOrder) ? tournament.standingsOrder : [],
    items,
  }));
}

function buildSettlementPlan(tournament, standings, options) {
  const source = tournament || {};
  const opts = options || {};
  const tournamentId = String(source._id || source.id || '').trim();
  if (!tournamentId) throw validationError('INVALID_TOURNAMENT', '赛事编号缺失');
  if (source.status !== 'finished' || !source.champion || !Number(source.archivedAt)) {
    throw validationError('INELIGIBLE_TOURNAMENT', '赛事需完成并归档后才能结算积分');
  }

  const teamCount = Number(source.N);
  if (SUPPORTED_TEAM_COUNTS.indexOf(teamCount) < 0) {
    throw validationError('UNSUPPORTED_TEAM_COUNT', '当前积分规则仅支持 4、8、16 支队伍');
  }
  if (!standings || standings.complete !== true || !Array.isArray(standings.items) || standings.items.length !== teamCount) {
    throw validationError('INCOMPLETE_STANDINGS', '赛事最终名次不完整，暂不能结算积分');
  }

  const season = getSeasonByTimestamp(source.archivedAt);
  if (!season) {
    throw validationError('UNSUPPORTED_SEASON', '赛事归档时间不在已配置的 2026 赛季内');
  }
  if (opts.seasonId && opts.seasonId !== season.seasonId) {
    throw validationError('SEASON_MISMATCH', '赛季与赛事归档时间不匹配');
  }

  const seenTeams = new Set();
  const rankCounts = new Map();
  const seenPlayers = new Set();
  const entries = [];
  const rosterSizes = [];
  (standings.items || []).forEach((item) => {
    const teamId = String(item.teamId || '').trim();
    if (!teamId || seenTeams.has(teamId)) throw validationError('INVALID_STANDINGS', '赛事名次包含缺失或重复的队伍');
    seenTeams.add(teamId);

    const rank = Number(item.rank);
    const deltaUnits = unitsForRank(teamCount, rank);
    if (!Number.isInteger(rank) || deltaUnits === null) {
      throw validationError('INVALID_STANDINGS', '赛事名次无法映射到积分规则');
    }
    rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
    const members = Array.isArray(item.members) ? item.members : [];
    const teamOpenids = new Set();
    members.forEach((member) => {
      const openid = normalizeOpenid(member);
      if (!openid || teamOpenids.has(openid) || seenPlayers.has(openid)) {
        throw validationError('INVALID_ROSTER', '赛事队员名单存在缺失或重复，请检查最终分组');
      }
      teamOpenids.add(openid);
      seenPlayers.add(openid);
      entries.push({
        entryId: sha256(season.seasonId + ':' + tournamentId + ':' + RULE_VERSION + ':' + openid),
        openid,
        nickname: String(member && member.nickname || ''),
        mmr: member && member.mmr !== null && member.mmr !== undefined && member.mmr !== '' &&
          Number.isFinite(Number(member.mmr)) ? Number(member.mmr) : null,
        teamId,
        teamName: String(item.teamName || item.team || ''),
        rank,
        rankLabel: String(item.label || ''),
        deltaUnits,
      });
    });
    if (!teamOpenids.size) throw validationError('INVALID_ROSTER', '队伍没有可结算的正式参赛成员');
    rosterSizes.push(teamOpenids.size);
  });

  if (seenTeams.size !== teamCount) throw validationError('INVALID_STANDINGS', '赛事名次队伍数与赛制不一致');
  if (rankCounts.get(1) !== 1 || rankCounts.get(2) !== 1) {
    throw validationError('INVALID_STANDINGS', '赛事冠军或亚军名次不唯一');
  }
  const championId = String(source.champion && source.champion.openid || '').trim();
  const firstPlace = (standings.items || []).find((item) => Number(item.rank) === 1);
  if (!championId || !firstPlace || String(firstPlace.teamId || '').trim() !== championId) {
    throw validationError('INVALID_STANDINGS', '赛事冠军与最终名次不一致');
  }
  if (rosterSizes.some((size) => size !== rosterSizes[0])) {
    throw validationError('ROSTER_MISMATCH', '各队正式参赛人数不一致，无法按个人计分并保持全场净额为零');
  }
  const expectedNetUnits = entries.reduce((sum, entry) => sum + entry.deltaUnits, 0);
  if (expectedNetUnits !== 0) throw validationError('NET_MISMATCH', '本场积分方案未通过全场净额校验');

  const settlementKey = season.seasonId + ':' + tournamentId + ':' + RULE_VERSION;
  return {
    settlementId: sha256(settlementKey),
    settlementKey,
    seasonId: season.seasonId,
    seasonLabel: season.label,
    tournamentId,
    tournamentName: String(source.name || '未命名赛事'),
    ruleVersion: RULE_VERSION,
    teamCount,
    participantCount: entries.length,
    rosterSize: rosterSizes[0],
    sourceFinalAt: Number(source.archivedAt),
    expectedNetUnits,
    fingerprint: fingerprintFor(source, standings),
    entries,
    createdAt: Number(opts.now) || Date.now(),
  };
}

function isTransactionConflict(error) {
  const code = String(error && (error.errCode || error.code) || '');
  const message = String(error && error.message || '');
  return /TRANSACTION.*(CONFLICT|ABORT|LOCK)|WRITE_CONFLICT|ABORTED/i.test(code) ||
    /transaction.{0,50}(conflict|abort|lock|retry)|write conflict/i.test(message);
}

async function readOptional(ref) {
  try {
    const result = await ref.get();
    return result && result.data || null;
  } catch (error) {
    const code = String(error && (error.errCode || error.code) || '');
    const message = String(error && error.message || '');
    if (/DOCUMENT_NOT_EXIST|NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST/i.test(code) || /document.*not exist|not found/i.test(message)) return null;
    throw error;
  }
}

async function applyLedgerEntry(db, entry, accountId, maxAttempts) {
  const attempts = Math.max(1, Number(maxAttempts) || 5);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await db.runTransaction(async (transaction) => {
        const ledgerRef = transaction.collection('seasonPointLedger').doc(entry.entryId);
        const existing = await readOptional(ledgerRef);
        if (existing) return { applied: false, duplicate: true };

        const accountRef = transaction.collection('seasonAccounts').doc(accountId);
        const account = await readOptional(accountRef);
        const now = Date.now();
        const nextAccount = {
          seasonId: entry.seasonId,
          openid: entry.openid,
          balanceUnits: (Number(account && account.balanceUnits) || 0) + entry.deltaUnits,
          settledMatches: (Number(account && account.settledMatches) || 0) + 1,
          nickname: entry.nickname || account && account.nickname || '',
          mmr: entry.mmr == null ? (account ? (account.mmr == null ? null : account.mmr) : null) : entry.mmr,
          lastSettledAt: now,
          updatedAt: now,
        };
        await ledgerRef.set({ data: entry });
        if (account) await accountRef.update({ data: nextAccount });
        else await accountRef.set({ data: nextAccount });
        return { applied: true, duplicate: false };
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(300, 20 * (2 ** (attempt - 1)))));
    }
  }
  throw new Error('积分流水写入冲突，请重试');
}

module.exports = {
  RULE_VERSION,
  UNIT_SCALE,
  SEASONS,
  SCORE_UNITS,
  SUPPORTED_TEAM_COUNTS,
  sha256,
  getSeasonById,
  getSeasonByTimestamp,
  defaultSeason,
  unitsForRank,
  validationError,
  buildSettlementPlan,
  applyLedgerEntry,
};
