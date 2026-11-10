const crypto = require('crypto');

const RULE_VERSION = 'points-v2';
const SUPPORTED_TEAM_COUNTS = [4, 8, 16];

const SEASONS = [
  { seasonId: '2026Q1', label: '2026 Q1', startAt: Date.parse('2026-01-01T00:00:00+08:00'), endAt: Date.parse('2026-04-01T00:00:00+08:00') },
  { seasonId: '2026Q2', label: '2026 Q2', startAt: Date.parse('2026-04-01T00:00:00+08:00'), endAt: Date.parse('2026-07-01T00:00:00+08:00') },
  { seasonId: '2026Q3', label: '2026 Q3', startAt: Date.parse('2026-07-01T00:00:00+08:00'), endAt: Date.parse('2026-10-01T00:00:00+08:00') },
  { seasonId: '2026Q4', label: '2026 Q4', startAt: Date.parse('2026-10-01T00:00:00+08:00'), endAt: Date.parse('2027-01-01T00:00:00+08:00') },
];

/**
 * 名次分值：表里的数字就是玩家看到的分数，不再折半。
 *
 * points-v2 起全员正分：最后一名也是加分，不再有扣分。
 * 单场赛事的合计按队伍数固定，参赛人均收益约 12-18 分：
 *   4 队 1+1+1+1      → 60 + 35 + 15 + 15     = 125
 *   8 队 1+1+2+4      → 120 + 70 + 45×2 + 15×4 = 340
 *   16 队 1+1+2+12    → 200 + 120 + 75×2 + 20×12 = 710
 */
const SCORE_UNITS = {
  4: { champion: 60, runnerUp: 35, thirdOrFourth: 15, other: null },
  8: { champion: 120, runnerUp: 70, thirdOrFourth: 45, other: 15 },
  16: { champion: 200, runnerUp: 120, thirdOrFourth: 75, other: 20 },
};

/**
 * 单败排位赛的分表：3、4、5、6 名各有独立分值（双败 / 单败仍用上面的四档表）。
 * 同样是全员正分、表值即分数，单场合计为一个固定正数：
 *   4 队  1+1+1+1        → 60 + 35 + 25 + 15 = 135
 *   8 队  1+1+1+1+2+2    → 120 + 75 + 55 + 40 + 25×2 + 15×2 = 370
 *   16 队 1+1+1+1+2+2+4+4 → 200 + 125 + 90 + 65 + 45×2 + 30×2 + 20×4 + 10×4 = 750
 */
const SCORE_UNITS_SINGLE_RANK = {
  4: { 1: 60, 2: 35, 3: 25, 4: 15 },
  8: { 1: 120, 2: 75, 3: 55, 4: 40, 5: 25, 6: 15 },
  16: { 1: 200, 2: 125, 3: 90, 4: 65, 5: 45, 6: 30, 9: 20, 10: 10 },
};

/**
 * 8 队挑选赛的分表：只有 8 队，季军与第 4 名分开，第二轮淘汰的四队并列第 5-8 名同分。
 *   8 队 1+1+1+1+4 → 130 + 85 + 60 + 45 + 20×4 = 400
 */
const SCORE_UNITS_PICK8 = {
  8: { 1: 130, 2: 85, 3: 60, 4: 45, 5: 20 },
};

/** 赛制：'singleRank' 单败排位赛、'single' 单败、'pick8' 8 队挑选赛，其余（含历史缺字段）按双败 */
function formatOfTournament(tournament) {
  const type = tournament && tournament.bracketType;
  if (type === 'singleRank') return 'singleRank';
  if (type === 'pick8') return 'pick8';
  if (type === 'single') return 'single';
  return 'double';
}

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

function unitsForRank(teamCount, rank, formatType) {
  const position = Number(rank);
  if (formatType === 'singleRank') {
    const table = SCORE_UNITS_SINGLE_RANK[Number(teamCount)];
    if (!table || !Number.isInteger(position)) return null;
    const value = table[position];
    return typeof value === 'number' ? value : null;
  }
  if (formatType === 'pick8') {
    const table = SCORE_UNITS_PICK8[Number(teamCount)];
    if (!table || !Number.isInteger(position)) return null;
    const value = table[position];
    return typeof value === 'number' ? value : null;
  }
  const rules = SCORE_UNITS[Number(teamCount)];
  if (!rules || !Number.isInteger(position) || position < 1 || position > teamCount) return null;
  if (position === 1) return rules.champion;
  if (position === 2) return rules.runnerUp;
  if (position === 3 || position === 4) return rules.thirdOrFourth;
  return rules.other;
}

/**
 * 分批结算的区间计算：从已写入的 applied 条开始，本次最多处理 batchSize 条。
 * 纯函数，便于单元测试；真正落库由 index.js 完成。
 */
function nextSettleRange(total, applied, batchSize) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const start = Math.min(Math.max(0, Math.floor(Number(applied) || 0)), count);
  const size = Math.max(1, Math.floor(Number(batchSize) || 1));
  const end = Math.min(count, start + size);
  return { start, end, done: start >= count };
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
  const formatType = formatOfTournament(source);
  (standings.items || []).forEach((item) => {
    const teamId = String(item.teamId || '').trim();
    if (!teamId || seenTeams.has(teamId)) throw validationError('INVALID_STANDINGS', '赛事名次包含缺失或重复的队伍');
    seenTeams.add(teamId);

    const rank = Number(item.rank);
    const deltaUnits = unitsForRank(teamCount, rank, formatType);
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
  // points-v2 规则下人人加分，单场合计是固定正数；这里只保证没有非正分值，
  // 不再要求全场净额为零（旧版本 points-v1 的净额校验已取消）。
  const expectedNetUnits = entries.reduce((sum, entry) => sum + entry.deltaUnits, 0);
  if (entries.some((entry) => entry.deltaUnits <= 0) || expectedNetUnits <= 0) {
    throw validationError('NET_MISMATCH', '本场积分分值必须全为正数，请检查分值表');
  }

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
  SEASONS,
  SCORE_UNITS,
  SCORE_UNITS_SINGLE_RANK,
  SCORE_UNITS_PICK8,
  SUPPORTED_TEAM_COUNTS,
  sha256,
  getSeasonById,
  getSeasonByTimestamp,
  defaultSeason,
  unitsForRank,
  nextSettleRange,
  validationError,
  buildSettlementPlan,
  applyLedgerEntry,
};
