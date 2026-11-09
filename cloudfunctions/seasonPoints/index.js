const cloud = require('wx-server-sdk');
const { calculateStandings } = require('./standings');
const {
  RULE_VERSION,
  UNIT_SCALE,
  SEASONS,
  SCORE_UNITS,
  sha256,
  getSeasonById,
  getSeasonByTimestamp,
  defaultSeason,
  buildSettlementPlan,
  applyLedgerEntry,
  nextSettleRange,
} = require('./core');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COLLECTIONS = ['seasonConfigs', 'seasonRules', 'seasonSettlements', 'seasonPointLedger', 'seasonAccounts'];
const CARD_PAGE_SIZE = 10; // 积分榜一页 10 张玩家名片
const BACKFILL_BATCH_SIZE = 1;
// 单次调用最多写入的积分流水条数：云函数 3 秒上限内，一人的事务约 0.3 秒，
// 取 6 条留出固定开销余量；写不完由下一次调用按 appliedEntries 续跑。
const SETTLE_BATCH_SIZE = 6;
const SKIPPABLE_BACKFILL_CODES = new Set([
  'INVALID_TOURNAMENT', 'INELIGIBLE_TOURNAMENT', 'UNSUPPORTED_TEAM_COUNT', 'INCOMPLETE_STANDINGS',
  'UNSUPPORTED_SEASON', 'SEASON_MISMATCH', 'INVALID_STANDINGS', 'INVALID_ROSTER',
  'ROSTER_MISMATCH', 'NET_MISMATCH',
]);
let schemaPromise = null;

function ok(data) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message };
}

function openidFromContext() {
  const context = cloud.getWXContext();
  return String(context && context.OPENID || '');
}

/**
 * 判断「集合已存在」。云开发 createCollection 在集合已存在时返回的是
 * errCode -501001 + errMsg "createCollection:fail -501001 resource system error.
 * [ResourceUnavailable.ResourceExist] Table exist..."，
 * 早期只匹配 ALREADY_EXIST/已存在，会把正常的「已建过」当成致命错误抛出，
 * 导致整个接口不可用，这里把该错误码与文案一并识别。
 */
function alreadyExists(error) {
  const code = String(error && (error.errCode || error.code) || '').toUpperCase();
  const message = String(error && (error.errMsg || error.message) || '');
  return /ALREADY_EXIST|COLLECTION_EXIST|RESOURCEEXIST/.test(code) ||
    /already exists|集合已存在|resourceexist|table exist/i.test(message);
}

function isMissingDocument(error) {
  const code = String(error && (error.errCode || error.code) || '');
  const message = String(error && error.message || '');
  return /DOCUMENT_NOT_EXIST|NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST/i.test(code) ||
    /document.*not exist|not found/i.test(message);
}

async function seedDocument(collectionName, id, data) {
  const result = await db.collection(collectionName).where({ _id: id }).limit(1).get();
  if (result.data && result.data.length) return;
  await db.collection(collectionName).doc(id).set({ data });
}

async function initializeSchema() {
  for (const collectionName of COLLECTIONS) {
    try {
      await db.createCollection(collectionName);
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
  }

  const now = Date.now();
  for (const season of SEASONS) {
    const active = now >= season.startAt && now < season.endAt;
    await seedDocument('seasonConfigs', season.seasonId, {
      seasonId: season.seasonId,
      displayName: season.label,
      timezone: 'Asia/Shanghai',
      startAt: season.startAt,
      endAt: season.endAt,
      status: active ? 'active' : now < season.startAt ? 'upcoming' : 'closed',
      enabled: true,
      ruleVersion: RULE_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  }
  await seedDocument('seasonRules', RULE_VERSION, {
    ruleVersion: RULE_VERSION,
    unitScale: UNIT_SCALE,
    scoreByTeamCount: SCORE_UNITS,
    seasonAssignmentPolicy: 'archivedAt',
    thirdAndFourthUseThirdPlaceScore: true,
    allowNegativeBalance: true,
    flatAdjustmentIncluded: false,
    createdAt: now,
  });
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = initializeSchema().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function resolveBracket(tournament) {
  const winners = {};
  const losers = {};
  const resolveSource = (source) => {
    if (!source) return null;
    if (source.type === 'team') return { openid: source.openid, name: source.name, teamIcon: source.teamIcon || '' };
    const map = source.slot === 'winner' ? winners : losers;
    return map[source.matchId] || null;
  };
  return (tournament.matches || []).map((match) => {
    const teamAInfo = resolveSource(match.teamA);
    const teamBInfo = resolveSource(match.teamB);
    const resolved = Object.assign({}, match, { teamAInfo, teamBInfo });
    if (match.status === 'done' && match.winner) {
      const winnerIsA = !!teamAInfo && teamAInfo.openid === match.winner;
      winners[match.id] = winnerIsA ? teamAInfo : teamBInfo;
      losers[match.id] = winnerIsA ? teamBInfo : teamAInfo;
    }
    return resolved;
  });
}

async function getAdminConfig() {
  const result = await db.collection('config').where({ key: 'admins' }).limit(1).get();
  return result.data && result.data[0] || { superAdmin: '', admins: [] };
}

async function isSuperAdmin(openid) {
  if (!openid) return false;
  const config = await getAdminConfig();
  return openid === config.superAdmin;
}

async function getTournament(tournamentId) {
  try {
    const result = await db.collection('tournaments').doc(tournamentId).get();
    const tournament = result && result.data;
    return tournament && !tournament.deletedAt ? tournament : null;
  } catch (error) {
    return null;
  }
}

async function createOrReadSettlement(plan) {
  const result = await db.runTransaction(async (transaction) => {
    const settlementRef = transaction.collection('seasonSettlements').doc(plan.settlementId);
    let existing = null;
    try {
      const current = await settlementRef.get();
      existing = current && current.data || null;
    } catch (error) {
      if (!isMissingDocument(error)) throw error;
    }
    if (existing) {
      if (existing.fingerprint !== plan.fingerprint) return { error: '赛事结果与历史结算不一致，请联系最高管理员核查' };
      return { settlement: existing, created: false };
    }
    const settlement = {
      settlementKey: plan.settlementKey,
      seasonId: plan.seasonId,
      tournamentId: plan.tournamentId,
      tournamentName: plan.tournamentName,
      ruleVersion: plan.ruleVersion,
      status: 'processing',
      sourceFinalAt: plan.sourceFinalAt,
      teamCount: plan.teamCount,
      participantCount: plan.participantCount,
      rosterSize: plan.rosterSize,
      expectedNetUnits: plan.expectedNetUnits,
      actualNetUnits: null,
      ledgerCount: plan.entries.length,
      fingerprint: plan.fingerprint,
      createdAt: plan.createdAt,
      updatedAt: plan.createdAt,
    };
    await settlementRef.set({ data: settlement });
    return { settlement, created: true };
  });
  if (result && result.error) throw new Error(result.error);
  return result;
}

async function updateSettlement(plan, patch) {
  await db.collection('seasonSettlements').doc(plan.settlementId).update({
    data: Object.assign({}, patch || {}, { updatedAt: Date.now() }),
  });
}

async function countAppliedLedger(settlementKey) {
  try {
    const result = await db.collection('seasonPointLedger').where({ settlementKey }).count();
    return Number(result && result.total) || 0;
  } catch (error) {
    return 0;
  }
}

async function settleTournamentInternal(tournament, options) {
  const opts = options || {};
  const standings = calculateStandings(tournament, resolveBracket(tournament), tournament.teams);
  const plan = buildSettlementPlan(tournament, standings, { now: Date.now() });
  const seasonQuery = await db.collection('seasonConfigs').where({ seasonId: plan.seasonId }).limit(1).get();
  const seasonConfig = seasonQuery.data && seasonQuery.data[0];
  if (!seasonConfig || !seasonConfig.enabled) throw new Error('该赛季积分功能尚未启用');
  if (seasonConfig.ruleVersion !== RULE_VERSION) throw new Error('该赛季规则版本与当前云函数不一致');

  const current = await createOrReadSettlement(plan);
  const settlement = current.settlement || {};
  const total = plan.entries.length;

  let applied = Math.min(Math.max(0, Number(settlement.appliedEntries) || 0), total);
  if (!Number.isFinite(Number(settlement.appliedEntries))) {
    // 老结算记录没有进度字段：用流水条数推断，避免每次都从头重判重复
    applied = Math.min(total, await countAppliedLedger(plan.settlementKey));
  }
  if (settlement.status === 'settled' && applied >= total) {
    return {
      settlementId: plan.settlementId,
      seasonId: plan.seasonId,
      alreadySettled: true,
      done: true,
      participantCount: total,
      appliedEntries: total,
      remaining: 0,
    };
  }

  const batchSize = Math.max(1, Math.min(Math.floor(Number(opts.batchSize) || SETTLE_BATCH_SIZE), 20));
  const range = nextSettleRange(total, applied, batchSize);
  let written = range.start;
  try {
    for (let index = range.start; index < range.end; index += 1) {
      const entry = plan.entries[index];
      const ledgerEntry = Object.assign({}, entry, {
        seasonId: plan.seasonId,
        tournamentId: plan.tournamentId,
        tournamentName: plan.tournamentName,
        settlementKey: plan.settlementKey,
        ruleVersion: plan.ruleVersion,
        eventAt: plan.sourceFinalAt,
        createdAt: Date.now(),
        entryType: 'settlement',
      });
      const accountId = sha256(plan.seasonId + ':' + entry.openid);
      await applyLedgerEntry(db, ledgerEntry, accountId);
      written = index + 1;
    }
  } catch (error) {
    // 只记录已写进度，保留 processing 状态，下一次调用继续写
    await updateSettlement(plan, {
      status: 'processing',
      appliedEntries: written,
      errorMessage: String(error && error.message || 'settlement interrupted'),
    }).catch(() => {});
    throw error;
  }

  if (written < total) {
    await updateSettlement(plan, { status: 'processing', appliedEntries: written, errorMessage: '' });
    return {
      settlementId: plan.settlementId,
      seasonId: plan.seasonId,
      alreadySettled: false,
      done: false,
      participantCount: total,
      appliedEntries: written,
      remaining: total - written,
    };
  }

  const actualNetUnits = plan.entries.reduce((sum, entry) => sum + entry.deltaUnits, 0);
  if (actualNetUnits !== plan.expectedNetUnits || actualNetUnits !== 0) {
    await updateSettlement(plan, { status: 'failed', appliedEntries: written, errorMessage: '积分流水净额校验失败' }).catch(() => {});
    throw new Error('积分流水净额校验失败');
  }
  await updateSettlement(plan, {
    status: 'settled',
    appliedEntries: total,
    actualNetUnits,
    completedAt: Date.now(),
    errorMessage: '',
  });
  return {
    settlementId: plan.settlementId,
    seasonId: plan.seasonId,
    alreadySettled: false,
    done: true,
    participantCount: total,
    appliedEntries: total,
    remaining: 0,
  };
}

function normalizeSeasonId(value) {
  const id = String(value || '').trim();
  return getSeasonById(id) ? id : '';
}

async function getUserRecord(openid) {
  const explicit = await db.collection('users').where({ openid }).limit(10).get();
  const owned = (explicit.data || []).find((item) => item && item._openid === openid);
  if (owned) return owned;
  const fallback = await db.collection('users').where({ _openid: openid }).limit(10).get();
  return fallback.data && fallback.data[0] || (explicit.data || [])[0] || null;
}

async function getUsersByOpenids(openids) {
  const unique = Array.from(new Set((openids || []).filter(Boolean)));
  if (!unique.length) return {};
  const output = {};
  const command = db.command;
  for (let offset = 0; offset < unique.length; offset += 20) {
    const batch = unique.slice(offset, offset + 20);
    const explicit = await db.collection('users').where({ openid: command.in(batch) }).limit(100).get();
    (explicit.data || []).forEach((user) => {
      if (user && user.openid && !output[user.openid]) output[user.openid] = user;
    });
    const missing = batch.filter((openid) => !output[openid]);
    if (missing.length) {
      const owned = await db.collection('users').where({ _openid: command.in(missing) }).limit(100).get();
      (owned.data || []).forEach((user) => {
        const openid = String(user && (user._openid || user.openid) || '');
        if (openid && !output[openid]) output[openid] = user;
      });
    }
  }
  return output;
}

function displayPoints(units) {
  const points = Number(units || 0) / UNIT_SCALE;
  return Number.isInteger(points) ? points : Number(points.toFixed(1));
}

/** 把用户档案收敛成名片组件需要的字段；缺失的字段回退到赛季账户里的快照。 */
function buildCardPlayer(profile, account) {
  const source = profile || {};
  const fallback = account || {};
  return {
    openid: String(fallback.openid || ''),
    nickname: String(source.nickname || fallback.nickname || '玩家'),
    signature: String(source.signature || ''),
    roles: Array.isArray(source.roles) ? source.roles : [],
    rolesText: String(source.rolesText || ''),
    dota2Id: source.dota2Id == null ? '' : String(source.dota2Id),
    dota2RankTier: source.dota2RankTier == null ? null : source.dota2RankTier,
    dota2RankVerified: source.dota2RankVerified,
    dota2RankVerifiedAt: source.dota2RankVerifiedAt || source.dota2VerifiedAt || 0,
    mmr: source.mmr == null
      ? (fallback.mmr == null ? null : Number(fallback.mmr))
      : Number(source.mmr),
    cardStyle: source.cardStyle || null,
  };
}

function seasonStatus(season, timestamp) {
  const now = Number(timestamp) || Date.now();
  return now >= season.startAt && now < season.endAt ? 'active' : now < season.startAt ? 'upcoming' : 'closed';
}

async function getSeasonSummaries() {
  const now = Date.now();
  return Promise.all(SEASONS.map(async (season) => {
    const result = await db.collection('seasonConfigs').where({ seasonId: season.seasonId }).limit(1).get();
    const config = result.data && result.data[0];
    return {
      code: season.seasonId,
      short: season.seasonId.slice(-2),
      label: config && config.displayName || season.label,
      period: season.seasonId.slice(0, 4) + 'Q' + season.seasonId.slice(-1),
      status: seasonStatus(season, now),
      enabled: !!(config && config.enabled),
    };
  }));
}

/**
 * 我的名次：按与榜单完全相同的 (积分降序, 昵称升序, _id 升序) 顺序数出前面有多少人。
 * 同分块逐页取回后按 openid 定位，避免依赖数据库字符串比较和前端 localeCompare 的排序差异。
 */
async function rankOfAccount(seasonId, account, units, totalPlayers) {
  const openid = String(account && account.openid || '');
  if (!openid) return null;
  try {
    const greater = await db.collection('seasonAccounts').where({ seasonId, balanceUnits: _.gt(units) }).count();
    const aheadBeforeBlock = Number(greater && greater.total) || 0;
    const blockLimit = Math.min(Math.max(totalPlayers, 1), 1000);
    for (let offset = 0; offset < blockLimit; offset += 100) {
      const block = await db.collection('seasonAccounts')
        .where({ seasonId, balanceUnits: units })
        .orderBy('nickname', 'asc')
        .orderBy('_id', 'asc')
        .skip(offset)
        .limit(100)
        .get();
      const rows = block.data || [];
      const index = rows.findIndex((item) => String(item.openid || '') === openid);
      if (index >= 0) return aheadBeforeBlock + offset + index + 1;
      if (rows.length < 100) break;
    }
    return null;
  } catch (error) {
    // 名次只是展示信息，算不出来不能连累整页榜单
    return null;
  }
}

async function getSeasonPage(openid, event) {
  const requestedSeason = normalizeSeasonId(event.seasonId);
  if (event.seasonId && !requestedSeason) throw new Error('赛季编号无效');
  const seasonId = requestedSeason || defaultSeason(Date.now()).seasonId;
  const result = await db.collection('seasonConfigs').where({ seasonId }).limit(1).get();
  const config = result.data && result.data[0];
  if (!config || !config.enabled) throw new Error('该赛季积分功能尚未开放');

  const accountId = sha256(seasonId + ':' + openid);
  let myAccount = null;
  try {
    const accountResult = await db.collection('seasonAccounts').doc(accountId).get();
    myAccount = accountResult && accountResult.data || null;
  } catch (error) {
    myAccount = null;
  }

  // 分页交给数据库：昵称已在结算时冗余进 seasonAccounts，可以按 (积分降序, 昵称升序, _id 升序)
  // 排序后用 skip/limit 取一页，不再把全赛季账户读进内存排序。
  const countResult = await db.collection('seasonAccounts').where({ seasonId }).count();
  const totalPlayers = Number(countResult && countResult.total) || 0;
  const totalPages = Math.max(1, Math.ceil(totalPlayers / CARD_PAGE_SIZE));
  const page = Math.min(Math.max(Math.floor(Number(event.page) || 1), 1), totalPages);
  const pageStart = (page - 1) * CARD_PAGE_SIZE;
  const pageResult = await db.collection('seasonAccounts')
    .where({ seasonId })
    .orderBy('balanceUnits', 'desc')
    .orderBy('nickname', 'asc')
    .orderBy('_id', 'asc')
    .skip(pageStart)
    .limit(CARD_PAGE_SIZE)
    .get();
  const pageAccounts = pageResult.data || [];
  const myUnits = Number(myAccount && myAccount.balanceUnits) || 0;
  const myRank = myAccount ? await rankOfAccount(seasonId, myAccount, myUnits, totalPlayers) : null;
  const profileMap = await getUsersByOpenids(pageAccounts.map((item) => item.openid).concat(openid));
  const leaderboard = pageAccounts.map((item, index) => {
    const profile = profileMap[item.openid] || {};
    return {
      // 名次按排序后的连续位置给出，避免并列积分时整页都是「1」
      rank: pageStart + index + 1,
      points: displayPoints(item.balanceUnits),
      mmr: profile.mmr == null ? (item.mmr == null ? null : Number(item.mmr)) : Number(profile.mmr),
      isMine: item.openid === openid,
      // 名片组件需要完整的人物字段，这里只带必要的展示字段，避免把整份用户文档传回前端
      player: buildCardPlayer(profile, item),
    };
  });
  const profile = profileMap[openid] || await getUserRecord(openid) || {};

  let ledger = [];
  if (openid) {
    const ledgerResult = await db.collection('seasonPointLedger')
      .where({ seasonId, openid })
      .orderBy('eventAt', 'desc')
      .limit(20)
      .get();
    ledger = ledgerResult.data || [];
  }

  const season = getSeasonById(seasonId);
  return {
    season: Object.assign({}, season, {
      status: seasonStatus(season, Date.now()),
      enabled: !!config.enabled,
      displayName: config.displayName || season.label,
    }),
    seasons: await getSeasonSummaries(),
    me: {
      nickname: String(profile.nickname || myAccount && myAccount.nickname || '未设置昵称'),
      mmr: profile.mmr == null ? (myAccount ? (myAccount.mmr == null ? null : Number(myAccount.mmr)) : null) : Number(profile.mmr),
      points: displayPoints(myUnits),
      rank: myRank,
      totalPlayers,
      settledMatches: Number(myAccount && myAccount.settledMatches) || 0,
    },
    leaderboard,
    leaderboardPage: {
      page,
      pageSize: CARD_PAGE_SIZE,
      totalPages,
      totalPlayers,
    },
    canBackfill: await isSuperAdmin(openid),
    records: ledger.map((item) => ({
      date: Number(item.eventAt || item.createdAt) || 0,
      title: String(item.tournamentName || '赛事结算'),
      detail: Number(item.teamCount) + ' 支队伍 · ' + String(item.rankLabel || ''),
      delta: displayPoints(item.deltaUnits),
    })),
    rule: {
      ruleVersion: config.ruleVersion || RULE_VERSION,
      unitScale: UNIT_SCALE,
    },
  };
}

async function getCardPoints(event) {
  const openids = Array.isArray(event && event.openids) ? event.openids : [];
  if (openids.length > 100) throw new Error('一次最多读取 100 位用户的赛季积分');
  const unique = Array.from(new Set(openids.map((openid) => String(openid || '').trim()).filter(Boolean)));
  if (unique.some((openid) => openid.length > 128)) throw new Error('用户编号无效');

  const season = defaultSeason(Date.now());
  const result = await db.collection('seasonConfigs').where({ seasonId: season.seasonId }).limit(1).get();
  const config = result.data && result.data[0];
  if (!config || !config.enabled || !unique.length) {
    return {
      seasonId: season.seasonId,
      seasonLabel: season.label,
      enabled: !!(config && config.enabled),
      points: unique.map(() => 0),
      matches: unique.map(() => 0),
    };
  }

  const accounts = await db.collection('seasonAccounts')
    .where({ seasonId: season.seasonId, openid: _.in(unique) })
    .limit(100)
    .get();
  const pointsByOpenid = new Map((accounts.data || []).map((account) => [String(account.openid), displayPoints(account.balanceUnits)]));
  const matchesByOpenid = new Map((accounts.data || []).map((account) => [String(account.openid), Number(account.settledMatches) || 0]));
  return {
    seasonId: season.seasonId,
    seasonLabel: config.displayName || season.label,
    enabled: true,
    points: unique.map((openid) => pointsByOpenid.has(openid) ? pointsByOpenid.get(openid) : 0),
    // 赛季参与场次（已结算的场数），名片上与积分同一排展示
    matches: unique.map((openid) => matchesByOpenid.get(openid) || 0),
  };
}

async function getSeasonHomeSummary(openid, seasonId) {
  if (!openid) throw new Error('无法识别当前用户');
  const accountId = sha256(seasonId + ':' + openid);
  let account = null;
  try {
    const result = await db.collection('seasonAccounts').doc(accountId).get();
    account = result && result.data || null;
  } catch (error) {
    if (!isMissingDocument(error)) throw error;
  }

  const totalResult = await db.collection('seasonAccounts').where({ seasonId }).count();
  let rank = null;
  if (account) {
    const aheadResult = await db.collection('seasonAccounts')
      .where({ seasonId, balanceUnits: _.gt(Number(account.balanceUnits) || 0) })
      .count();
    rank = Number(aheadResult.total || 0) + 1;
  }
  return {
    points: displayPoints(account && account.balanceUnits),
    rank,
    totalPlayers: Number(totalResult.total) || 0,
    settledMatches: Number(account && account.settledMatches) || 0,
  };
}

async function backfillArchivedBatch(openid, cursorValue) {
  if (!(await isSuperAdmin(openid))) throw new Error('只有最高管理员可以补算历史积分');
  const input = cursorValue && typeof cursorValue === 'object' ? cursorValue : {};
  const hasCursorFields = input.snapshotAt !== undefined || input.snapshotId !== undefined ||
    input.archivedAt !== undefined || input.id !== undefined;
  let snapshotAt = Number(input.snapshotAt) || 0;
  let snapshotId = String(input.snapshotId || '');
  if (!snapshotAt) {
    const latest = await db.collection('tournaments')
      .where({ archivedAt: _.gt(0) })
      .orderBy('archivedAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(1)
      .get();
    snapshotAt = Number(latest.data && latest.data[0] && latest.data[0].archivedAt) || 0;
    snapshotId = String(latest.data && latest.data[0] && latest.data[0]._id || '');
  }
  if (!snapshotAt) return { done: true, nextCursor: null, processed: 0, skipped: 0, errors: [] };

  const lastArchivedAt = Number(input.archivedAt) || 0;
  const lastId = String(input.id || '');
  if ((hasCursorFields && (!Number.isFinite(Number(input.snapshotAt)) || Number(input.snapshotAt) <= 0 ||
      !snapshotId || snapshotId.length > 128)) ||
      ((lastArchivedAt || lastId) &&
      (!Number.isFinite(lastArchivedAt) || lastArchivedAt <= 0 || lastArchivedAt > snapshotAt ||
       !lastId || lastId.length > 128)) ||
      (hasCursorFields && (!lastArchivedAt || !lastId || lastArchivedAt === snapshotAt && lastId >= snapshotId))) {
    throw new Error('历史补算游标无效，请重新开始扫描');
  }

  let ranges;
  if (!lastArchivedAt) {
    ranges = [
      { archivedAt: _.gt(0).and(_.lt(snapshotAt)) },
      { archivedAt: snapshotAt, _id: _.lte(snapshotId) },
    ];
  } else if (lastArchivedAt < snapshotAt) {
    ranges = [
      { archivedAt: _.gt(lastArchivedAt).and(_.lt(snapshotAt)) },
      { archivedAt: lastArchivedAt, _id: _.gt(lastId) },
      { archivedAt: snapshotAt, _id: _.lte(snapshotId) },
    ];
  } else {
    ranges = [{ archivedAt: snapshotAt, _id: _.gt(lastId).and(_.lte(snapshotId)) }];
  }
  const result = await db.collection('tournaments').where({ _or: ranges })
    .orderBy('archivedAt', 'asc')
    .orderBy('_id', 'asc')
    .limit(BACKFILL_BATCH_SIZE + 1)
    .get();
  const tournaments = result.data || [];
  if (!tournaments.length) return { done: true, nextCursor: null, processed: 0, skipped: 0, errors: [] };
  let processed = 0;
  let skipped = 0;
  const errors = [];
  const tournament = tournaments[0];
  let settleResult = null;
  if (tournament.deletedAt || tournament.status !== 'finished') {
    skipped = 1;
    processed = 1;
  } else {
    try {
      settleResult = await settleTournamentInternal(tournament, { backfill: true });
      processed = settleResult && settleResult.done === false ? 0 : 1;
    } catch (error) {
      const code = String(error && error.code || '');
      if (SKIPPABLE_BACKFILL_CODES.has(code)) {
        processed = 0;
        skipped += 1;
        errors.push({ tournamentName: String(tournament.name || '未命名赛事'), code, reason: error.message });
      } else {
        throw error;
      }
    }
  }

  // 一场比赛要分多次调用才能写完时，游标不前进，下一次继续结算同一场
  if (settleResult && settleResult.done === false) {
    const keptCursor = cursorValue && typeof cursorValue === 'object' ? cursorValue : null;
    return {
      done: false,
      nextCursor: keptCursor,
      processed,
      skipped,
      errors,
      pending: {
        tournamentId: String(tournament._id || ''),
        tournamentName: String(tournament.name || '未命名赛事'),
        appliedEntries: Number(settleResult.appliedEntries) || 0,
        participantCount: Number(settleResult.participantCount) || 0,
      },
    };
  }
  return {
    done: tournaments.length <= BACKFILL_BATCH_SIZE,
    nextCursor: tournaments.length <= BACKFILL_BATCH_SIZE ? null : {
      snapshotAt,
      snapshotId,
      archivedAt: Number(tournament.archivedAt) || 0,
      id: String(tournament._id || ''),
    },
    processed,
    skipped,
    errors,
  };
}

const actions = {
  async getFeatureConfig() {
    await ensureSchema();
    const season = defaultSeason(Date.now());
    const result = await db.collection('seasonConfigs').where({ seasonId: season.seasonId }).limit(1).get();
    const config = result.data && result.data[0];
    return ok({
      enabled: !!(config && config.enabled),
      currentSeasonId: season.seasonId,
      supportedSeasons: SEASONS.map((item) => item.seasonId),
      seasons: await getSeasonSummaries(),
    });
  },

  async getHomeSummary() {
    const openid = openidFromContext();
    if (!openid) return fail('无法识别当前用户');
    await ensureSchema();
    const season = defaultSeason(Date.now());
    const result = await db.collection('seasonConfigs').where({ seasonId: season.seasonId }).limit(1).get();
    const config = result.data && result.data[0];
    const enabled = !!(config && config.enabled);
    return ok({
      enabled,
      currentSeasonId: season.seasonId,
      seasonLabel: config && config.displayName || season.label,
      me: enabled ? await getSeasonHomeSummary(openid, season.seasonId) : null,
    });
  },

  async getSeasonPage(event) {
    const openid = openidFromContext();
    if (!openid) return fail('无法识别当前用户');
    await ensureSchema();
    return ok(await getSeasonPage(openid, event || {}));
  },

  async getCardPoints(event) {
    await ensureSchema();
    return ok(await getCardPoints(event || {}));
  },

  async settleTournament(event) {
    const openid = openidFromContext();
    if (!openid) return fail('无法识别当前用户');
    const tournamentId = String(event && event.tournamentId || '').trim();
    if (!tournamentId || tournamentId.length > 128) return fail('赛事编号无效');
    await ensureSchema();
    const tournament = await getTournament(tournamentId);
    if (!tournament) return fail('比赛不存在');
    const config = await getAdminConfig();
    const allowed = tournament.createdBy === openid || config.superAdmin === openid;
    if (!allowed) return fail('只有比赛创建者或最高管理员可以结算本场积分');
    return ok(await settleTournamentInternal(tournament, { batchSize: event && event.batchSize }));
  },

  async backfillArchived(event) {
    const openid = openidFromContext();
    if (!openid) return fail('无法识别当前用户');
    await ensureSchema();
    return ok(await backfillArchivedBatch(openid, event && event.cursor));
  },
};

exports.main = async (event) => {
  try {
    const action = String(event && event.action || '');
    const handler = actions[action];
    if (!handler) return fail('未知操作：' + action);
    return await handler(event || {});
  } catch (error) {
    console.error('seasonPoints cloud function error:', error);
    return fail(error && error.message || '赛季积分服务异常，请稍后重试');
  }
};

exports._internals = { initializeSchema, ensureSchema, resolveBracket, getSeasonPage, getCardPoints, settleTournamentInternal, backfillArchivedBatch };
