/**
 * 赛事读取与组装：详情/版本/报名快照/摘要列表/首页统计/对阵解析/比赛页组装/赛后感言辅助。
 * 从原 index.js 拆出（纯搬移）。
 */
const { db, _ } = require('./db');
const { getOpenId } = require('./utils');
const { MAX_COMMENT_LENGTH, MAX_COMMENTS } = require('./constants');
const { normalizeCardStyle } = require('./cards');
const { publicDotaCardFields } = require('./card-profile');
const { REGISTRATION_PROFILE_FIELDS, getUser, getUsersByOpenids } = require('./users');
const { hasTournamentCreateAccess } = require('./create-permission');
const { getAdminsConfig, isSuper, isAdmin, canManageTournament } = require('./permissions');
const { calculateStandings } = require('./standings');
const { resolveBracket } = require('./bracket-resolve');
const { buildRegistrationSummary } = require('./tournament-transaction');
const { TOURNAMENT_SUMMARY_FIELDS, summarize } = require('./tournament-summary');
const { chinaDayRange, createQuotaId, effectiveDailyCount, createDailyLimit } = require('./daily-quota');
const { describeHistoryQuery, applySettlementStates } = require('./history-query');
const { seasonOfTimestamp } = require('./season-window');

/* ---------------- 赛后感言辅助 ---------------- */

function commentOwner(comment) {
  if (!comment || typeof comment !== 'object') return '';
  return String(comment.openid || comment.userOpenid || '').trim();
}

function normalizeComment(comment, viewerOpenid) {
  if (!comment || typeof comment !== 'object') return null;
  const text = String(comment.text || '').trim();
  if (!text) return null;
  const createdAt = Number(comment.createdAt) || 0;
  const updatedAt = Number(comment.updatedAt) || 0;
  const owner = commentOwner(comment);
  return {
    nickname: String(comment.nickname || '用户').trim().slice(0, 20) || '用户',
    text: Array.from(text).slice(0, MAX_COMMENT_LENGTH).join(''),
    createdAt,
    updatedAt: updatedAt || null,
    isMine: !!viewerOpenid && owner === viewerOpenid,
  };
}

function publicComments(tournament, viewerOpenid) {
  return (Array.isArray(tournament && tournament.comments) ? tournament.comments : [])
    .map((comment) => normalizeComment(comment, viewerOpenid))
    .filter(Boolean)
    .slice(-MAX_COMMENTS);
}

function isTournamentParticipant(tournament, openid) {
  if (!tournament || !openid) return false;
  if ((tournament.registrations || []).some((r) => r && r.openid === openid)) return true;
  return (tournament.teams || []).some((team) => {
    if (!team) return false;
    const captain = team.captain;
    if ((typeof captain === 'string' ? captain : captain && captain.openid) === openid) return true;
    return (team.players || []).some((player) =>
      (typeof player === 'string' ? player : player && player.openid) === openid
    );
  });
}

function canPostComment(tournament, openid, adminFlag) {
  // 冠军产生后，比赛创建者或最高管理员可能尚未点击归档；此时也允许在结算页留下感言。
  if (!tournament || tournament.status !== 'finished' || !tournament.champion) return false;
  return !!adminFlag || isTournamentParticipant(tournament, openid);
}

/* ---------------- 赛事读取 ---------------- */

async function getTournamentById(id, includeDeleted) {
  try {
    const res = await db.collection('tournaments').doc(id).get();
    const tournament = res.data || null;
    return tournament && (includeDeleted || !tournament.deletedAt) ? tournament : null;
  } catch (e) {
    return null;
  }
}

async function getTournamentVersion(id) {
  if (!id) return null;
  try {
    const result = await db.collection('tournaments').where({ _id: id })
      .field({ updatedAt: true, createdAt: true, status: true, deletedAt: true })
      .limit(1)
      .get();
    const tournament = result.data && result.data.length ? result.data[0] : null;
    if (!tournament) return null;
    return {
      id,
      updatedAt: Number(tournament.updatedAt || tournament.createdAt || 0),
      status: tournament.status || '',
      deletedAt: tournament.deletedAt || null,
    };
  } catch (e) {
    return null;
  }
}

async function getTournamentRegistrationSnapshot(id, openid) {
  if (!id) return null;
  try {
    const result = await db.collection('tournaments').where({ _id: id })
      .field({
        _id: true,
        name: true,
        time: true,
        creatorName: true,
        createdBy: true,
        status: true,
        updatedAt: true,
        createdAt: true,
        deletedAt: true,
        champion: true,
        mode: true,
        N: true,
        K: true,
        waitLimit: true,
        registrations: true,
        secret: true,
      })
      .limit(1)
      .get();
    const tournament = result.data && result.data.length ? result.data[0] : null;
    if (!tournament || tournament.deletedAt) return null;
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];
    const count = (role) => registrations.filter((registration) => registration && registration.role === role).length;
    const cfg = await getAdminsConfig();
    const superFlag = openid === cfg.superAdmin;
    const isAdminFlag = superFlag || (Array.isArray(cfg.admins) && cfg.admins.indexOf(openid) >= 0);
    const isOwner = !!(tournament.createdBy && tournament.createdBy === openid);
    const canManage = isOwner || isAdminFlag;
    const canDelete = isOwner || superFlag;
    return {
      id: tournament._id,
      name: tournament.name || '',
      time: tournament.time || '',
      creatorName: tournament.creatorName || '',
      createdBy: tournament.createdBy || '',
      isOwner,
      isSuper: superFlag,
      isAdmin: isAdminFlag,
      canManage,
      canDelete,
      secret: canManage ? tournament.secret || '' : '', // 暗号仅本场创建者或管理员可见
      status: tournament.status || '',
      updatedAt: Number(tournament.updatedAt || tournament.createdAt || 0),
      champion: tournament.champion || null,
      mode: tournament.mode === 'auto' ? 'auto' : 'captain',
      N: tournament.N,
      K: tournament.K,
      waitLimit: Number(tournament.waitLimit) || 0,
      registrations,
      myReg: openid ? registrations.find((registration) => registration && registration.openid === openid) || null : null,
      captainFilled: count('captain'),
      playerFilled: count('player'),
      waitlistFilled: count('waitlist'),
      captainTotal: tournament.mode === 'auto' ? 0 : tournament.N,
      playerTotal: Number(tournament.N) * Number(tournament.K),
    };
  } catch (e) {
    return null;
  }
}

async function decorateRegistrationSnapshot(snapshot) {
  if (!snapshot) return null;
  const registrations = Array.isArray(snapshot.registrations) ? snapshot.registrations : [];
  const profiles = await getUsersByOpenids(
    registrations.map((registration) => registration && registration.openid),
    REGISTRATION_PROFILE_FIELDS
  );
  const decorated = registrations.map((registration) => {
    const member = registration || {};
    const profile = profiles[member.openid];
    const cardPlayer = Object.assign({}, member);
    if (profile) {
      ['nickname', 'mmr', 'roles', 'signature'].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(profile, field)) cardPlayer[field] = profile[field];
      });
    }
    return Object.assign(cardPlayer, publicDotaCardFields(cardPlayer.mmr, profile || cardPlayer, null), {
      cardStyle: profile ? normalizeCardStyle(profile.cardStyle) : normalizeCardStyle(cardPlayer.cardStyle),
    });
  });
  const myReg = snapshot.myReg
    ? decorated.find((registration) => registration.openid === snapshot.myReg.openid) || snapshot.myReg
    : null;
  return Object.assign({}, snapshot, { registrations: decorated, myReg });
}

async function hydrateLegacyRegistrationSummaries(tournaments) {
  const source = Array.isArray(tournaments) ? tournaments : [];
  const legacy = source.filter((tournament) =>
    !tournament || !tournament.registrationCounts || !Array.isArray(tournament.registeredOpenids)
  );
  if (!legacy.length) return source;
  const ids = Array.from(new Set(legacy.map((tournament) => tournament && tournament._id).filter(Boolean)));
  const detailResults = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    try {
      const result = await db.collection('tournaments').where({ _id: _.in(chunk) })
        .field({ registrations: true, updatedAt: true, createdAt: true })
        .limit(100)
        .get();
      detailResults.push(...((result && result.data) || []));
    } catch (e) {
      throw e;
    }
  }
  const detailsById = {};
  detailResults.forEach((detail) => {
    if (detail && detail._id) detailsById[detail._id] = detail;
  });
  const hydrated = await Promise.all(legacy.map(async (tournament) => {
    if (!tournament || !tournament._id) return tournament;
    const detail = detailsById[tournament._id];
    if (!detail) throw new Error('读取旧赛事报名摘要失败');
    const summary = buildRegistrationSummary(detail.registrations);
    const versionField = detail.updatedAt ? 'updatedAt' : 'createdAt';
    const versionValue = detail[versionField];
    if (versionValue) {
      const update = await db.collection('tournaments').where({ _id: tournament._id, [versionField]: versionValue }).update({
        data: summary,
      });
      if (!update.stats || update.stats.updated !== 1) {
        const latestResult = await db.collection('tournaments').doc(tournament._id).get();
        const latest = latestResult && latestResult.data;
        if (!latest) throw new Error('读取旧赛事报名摘要失败');
        return Object.assign({}, tournament, latest, buildRegistrationSummary(latest.registrations));
      }
    }
    return Object.assign({}, tournament, detail, summary);
  }));
  const byId = {};
  hydrated.forEach((tournament) => {
    if (tournament && tournament._id) byId[tournament._id] = tournament;
  });
  return source.map((tournament) => byId[tournament._id] || tournament);
}

async function getRecentTournamentSummaries(filter, limit, openid, archived) {
  const summaries = [];
  let offset = 0;
  const cfg = await getAdminsConfig();
  const superFlag = !!openid && openid === cfg.superAdmin;
  const adminList = Array.isArray(cfg.admins) ? cfg.admins : [];
  while (summaries.length < limit) {
    const result = await db.collection('tournaments')
      .where(filter)
      .field(TOURNAMENT_SUMMARY_FIELDS)
      .orderBy('createdAt', 'desc')
      .skip(offset)
      .limit(100)
      .get();
    const batch = result.data || [];
    const matching = batch.filter((tournament) => !tournament.deletedAt &&
      (archived == null || !!tournament.archivedAt === archived))
      .slice(0, Math.max(0, limit - summaries.length));
    const hydrated = await hydrateLegacyRegistrationSummaries(matching);
    summaries.push(...hydrated.map((tournament) => {
      const isOwner = !!(openid && tournament.createdBy && tournament.createdBy === openid);
      const isAdminFlag = superFlag || (adminList.indexOf(openid) >= 0);
      return Object.assign(summarize(tournament, openid), {
        createdBy: tournament.createdBy || '',
        isOwner,
        isSuper: superFlag,
        isAdmin: isAdminFlag,
        canManage: isOwner || isAdminFlag,
        canDelete: isOwner || superFlag,
      });
    }));
    offset += batch.length;
    if (batch.length < 100) break;
  }
  return summaries.slice(0, limit);
}

/* ---------------- 历史列表：createdAt 游标分页 ---------------- */

/* 历史列表的 where 条件：往期赛事 + 今天已归档的赛事；今天的进行中赛事留在首页「今天的比赛」。 */
function buildHistoryFilter(desc) {
  const keywordPart = desc.regexp ? { name: db.RegExp({ regexp: desc.regexp, options: 'i' }) } : {};
  // 游标是「上一页最后一条的 createdAt」，用 < cursor+1 表达 <= cursor（createdAt 为整毫秒）
  const cursorUpper = desc.cursorCreatedAt ? desc.cursorCreatedAt + 1 : 0;
  const season = desc.season;
  const seasonRange = season ? _.gte(season.startAt).and(_.lt(season.endAt)) : null;
  const branches = [];

  if (!desc.todayStart) {
    if (season) {
      // 已归档：按归档时间归属赛季；未归档/未结束：按创建时间归属赛季
      const archived = Object.assign({}, keywordPart, { archivedAt: seasonRange });
      if (cursorUpper) archived.createdAt = _.lt(cursorUpper);
      branches.push(archived);
      const unarchived = Object.assign({}, keywordPart, {
        archivedAt: null,
        createdAt: cursorUpper
          ? _.gte(season.startAt).and(_.lt(Math.min(season.endAt, cursorUpper)))
          : _.gte(season.startAt).and(_.lt(season.endAt)),
      });
      branches.push(unarchived);
    } else {
      const all = Object.assign({}, keywordPart);
      if (cursorUpper) all.createdAt = _.lt(cursorUpper);
      branches.push(all);
    }
    return branches.length === 1 ? branches[0] : _.or(branches);
  }

  const olderUpper = cursorUpper ? Math.min(desc.todayStart, cursorUpper) : desc.todayStart;
  if (season) {
    // 往期已归档：归档时间落在赛季内
    branches.push(Object.assign({}, keywordPart, {
      createdAt: _.lt(olderUpper),
      archivedAt: seasonRange,
    }));
    // 往期未归档/未结束：创建时间落在赛季内（archivedAt 为空或不存在）
    branches.push(Object.assign({}, keywordPart, {
      archivedAt: null,
      createdAt: _.gte(season.startAt).and(_.lt(Math.min(season.endAt, olderUpper))),
    }));
  } else {
    // 往期全部（含尚未归档的旧比赛）
    branches.push(Object.assign({}, keywordPart, { createdAt: _.lt(olderUpper) }));
  }
  // 今天已归档的比赛（今天还在报名/对战中的留在首页）
  const todayRange = cursorUpper
    ? _.gte(desc.todayStart).and(_.lt(cursorUpper))
    : _.gte(desc.todayStart);
  branches.push(Object.assign({}, keywordPart, {
    createdAt: todayRange,
    archivedAt: season ? seasonRange : _.gt(0),
  }));
  return branches.length === 1 ? branches[0] : _.or(branches);
}

/*
 * 历史赛事分页查询。
 * 返回 { items, hasMore, cursor: { createdAt, id } }：前端把 cursor 原样带回即可续页。
 * 同一毫秒创建的赛事用 id 兜底去重，保证不会有记录被跳过或重复出现。
 */
async function queryHistoryPage(options) {
  const desc = describeHistoryQuery(options);
  const openid = String((options && options.openid) || '');
  const cfg = await getAdminsConfig();
  const superFlag = !!openid && openid === cfg.superAdmin;
  const adminList = Array.isArray(cfg.admins) ? cfg.admins : [];
  const seen = new Set(desc.cursorId ? [desc.cursorId] : []);
  const items = [];
  let cursorAt = desc.cursorCreatedAt;
  let hasMore = false;
  let rounds = 0;
  const pageSize = Math.min(100, Math.max(desc.limit * 2, 30));

  while (items.length < desc.limit && rounds < 4) {
    rounds += 1;
    const where = buildHistoryFilter(Object.assign({}, desc, { cursorCreatedAt: cursorAt }));
    const result = await db.collection('tournaments')
      .where(where)
      .field(TOURNAMENT_SUMMARY_FIELDS)
      .orderBy('createdAt', 'desc')
      .limit(pageSize)
      .get();
    const batch = (result && result.data) || [];
    if (!batch.length) break;

    const fresh = batch.filter((tournament) => tournament && tournament._id &&
      !tournament.deletedAt && !seen.has(tournament._id));
    let leftover = false;
    if (fresh.length) {
      const hydrated = await hydrateLegacyRegistrationSummaries(fresh);
      const summaries = hydrated.map((tournament) => {
        const isOwner = !!(openid && tournament.createdBy && tournament.createdBy === openid);
        const isAdminFlag = superFlag || (adminList.indexOf(openid) >= 0);
        const season = seasonOfTimestamp(tournament.archivedAt || tournament.createdAt);
        return Object.assign(summarize(tournament, openid), {
          createdBy: tournament.createdBy || '',
          isOwner,
          isSuper: superFlag,
          isAdmin: isAdminFlag,
          canManage: isOwner || isAdminFlag,
          canDelete: isOwner || superFlag,
          seasonId: season ? season.seasonId : '',
          seasonLabel: season ? season.label : '',
        });
      });
      for (let index = 0; index < summaries.length; index += 1) {
        if (items.length >= desc.limit) {
          leftover = true;
          break;
        }
        items.push(summaries[index]);
      }
    }
    // 本页已处理过的记录不再重复处理，避免同一毫秒的多条赛事导致翻页打转
    batch.forEach((tournament) => {
      if (tournament && tournament._id) seen.add(tournament._id);
    });
    const last = batch[batch.length - 1];
    const lastAt = Number(last && last.createdAt) || 0;
    const advanced = lastAt > 0 && lastAt !== cursorAt;
    if (lastAt > 0) cursorAt = lastAt;
    if (items.length >= desc.limit) {
      // 本页还有没返回的记录，或这一页还没读到底，都说明后面还有数据
      hasMore = leftover || batch.length >= pageSize;
      break;
    }
    if (batch.length < pageSize) break;
    if (!advanced) break;
  }

  const states = await loadSettlementStates(items.map((item) => item.id));
  const settledItems = applySettlementStates(items, states);
  const lastItem = settledItems[settledItems.length - 1];
  const cursor = lastItem ? { createdAt: Number(lastItem.createdAt) || 0, id: lastItem.id } : null;
  return { items: settledItems, hasMore: settledItems.length >= desc.limit ? hasMore : false, cursor, desc };
}

/* 批量读取赛季结算记录：status = processing / settled / failed；集合不存在或读取失败按未结算处理。 */
async function loadSettlementStates(ids) {
  const states = {};
  const source = (Array.isArray(ids) ? ids : []).filter(Boolean);
  if (!source.length) return states;
  try {
    for (let offset = 0; offset < source.length; offset += 100) {
      const chunk = source.slice(offset, offset + 100);
      const result = await db.collection('seasonSettlements')
        .where({ tournamentId: _.in(chunk) })
        .field({ tournamentId: true, status: true })
        .limit(100)
        .get();
      ((result && result.data) || []).forEach((doc) => {
        if (doc && doc.tournamentId) states[String(doc.tournamentId)] = doc.status || 'processing';
      });
    }
  } catch (e) {
    // 赛季积分服务未初始化时不影响历史列表，标记全部未结算
    return {};
  }
  return states;
}

/* 读取赛事 + 管理权限校验，action 里统一用它拿 (tournament, openid)。 */
async function requireTournamentManager(event, includeDeleted) {
  const openid = getOpenId();
  const tournament = await getTournamentById(event && event.id, !!includeDeleted);
  if (!tournament) return { error: '比赛不存在' };
  if (!(await canManageTournament(tournament, openid))) {
    return { error: '只有比赛创建者或管理员可以操作本场比赛' };
  }
  return { tournament, openid };
}

async function getTodayCreateStats(openid, now, createAccessFlag) {
  if (!openid) return { todayCreateCount: 0, todayCreateRemaining: 0, todayCreateLimit: 0, dailyLimit: 0 };
  const hasAccess = typeof createAccessFlag === 'boolean'
    ? createAccessFlag
    : hasTournamentCreateAccess(await getUser(openid), await isAdmin(openid));
  const limit = createDailyLimit(hasAccess);
  if (!limit) return { todayCreateCount: 0, todayCreateRemaining: 0, todayCreateLimit: 0, dailyLimit: 0 };
  const range = chinaDayRange(now);
  const quotaId = createQuotaId(openid, range.dayKey);
  const quotaResult = await db.collection('config').where({ _id: quotaId }).limit(1).get();
  const quotaCount = Number(quotaResult && quotaResult.data && quotaResult.data[0] && quotaResult.data[0].count) || 0;
  const tournaments = await db.collection('tournaments')
    .where({ createdBy: openid, createdAt: _.gte(range.start).and(_.lt(range.end)) })
    .limit(3)
    .get();
  // Count even permanently deleted and legacy soft-deleted documents; the quota record
  // preserves counts after permanent deletion during the current day.
  const count = effectiveDailyCount(quotaCount, (tournaments && tournaments.data || []).length);
  return {
    todayCreateCount: count,
    todayCreateRemaining: Math.max(0, limit - count),
    todayCreateLimit: limit,
    dailyLimit: limit,
  };
}

/* ---------------- 对阵解析 ---------------- */

/* 赛制归一化：单败排位赛、8 队挑选赛单独取值，其余（含历史文档缺字段）按双败 */
function normalizeBracketType(value) {
  if (value === 'singleRank') return 'singleRank';
  if (value === 'pick8') return 'pick8';
  return value === 'single' ? 'single' : 'double';
}

/* 解析对阵：见 bracket-resolve.js（纯函数，赛事详情与生涯统计共用） */


/* 组装比赛页完整数据 */
async function composeTournament(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const rawRegistrations = t.registrations || [];
  const profileOpenids = [];
  const addMemberOpenid = (member) => {
    const openid = typeof member === 'string' ? member : member && member.openid;
    if (typeof openid === 'string' && openid && profileOpenids.indexOf(openid) < 0) profileOpenids.push(openid);
  };
  rawRegistrations.forEach(addMemberOpenid);
  (t.teams || []).forEach((team) => {
    if (!team) return;
    addMemberOpenid(team.captain);
    (team.players || []).forEach(addMemberOpenid);
  });
  (t.captainOrder || []).forEach(addMemberOpenid);
  ((t.draft && t.draft.picks) || []).forEach((team) => (team || []).forEach(addMemberOpenid));
  const [userProfiles, adminConfig] = await Promise.all([
    getUsersByOpenids(profileOpenids),
    getAdminsConfig(),
  ]);
  const cardStyles = {};
  Object.keys(userProfiles).forEach((openid) => {
    cardStyles[openid] = normalizeCardStyle(userProfiles[openid].cardStyle);
  });
  const decorateCardPlayer = (member) => {
    const snapshot = member || {};
    const profile = userProfiles[snapshot.openid];
    const cardPlayer = Object.assign({}, snapshot);
    // The registration/team document keeps role and team metadata, while the
    // card content follows the user's current profile just like 我的.
    if (profile) {
      ['nickname', 'mmr', 'roles', 'signature'].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(profile, field)) cardPlayer[field] = profile[field];
      });
    }
    return Object.assign(cardPlayer, publicDotaCardFields(
      cardPlayer.mmr,
      profile || cardPlayer,
      null
    ), {
      cardStyle: cardStyles[snapshot.openid] || normalizeCardStyle(cardPlayer.cardStyle),
    });
  };
  const registrations = rawRegistrations.map((r) => decorateCardPlayer(r));
  // 系统分组模式无队长名额；队员名额 = 队伍数 × 每组人数（K）
  const captainTotal = mode === 'auto' ? 0 : t.N;
  const playerTotal = t.N * t.K;
  const waitLimit = t.waitLimit || 0;
  const captains = registrations.filter((r) => r.role === 'captain');
  const players = registrations.filter((r) => r.role === 'player');
  const waitlist = registrations.filter((r) => r.role === 'waitlist');
  const myReg = registrations.find((r) => r.openid === myOpenid) || null;
  const registrationMap = {};
  registrations.forEach((registration) => (registrationMap[registration.openid] = registration));
  const decorateTeamMember = (member) => {
    if (!member) return member;
    const registration = typeof member === 'string' ? registrationMap[member] : registrationMap[member.openid];
    const source = typeof member === 'string'
      ? registration || { openid: member }
      : Object.assign({}, registration || {}, member);
    return decorateCardPlayer(source);
  };
  const superFlag = myOpenid === adminConfig.superAdmin;
  const isAdminFlag = superFlag || (Array.isArray(adminConfig.admins) && adminConfig.admins.indexOf(myOpenid) >= 0);
  const isOwner = !!(t.createdBy && t.createdBy === myOpenid);
  const canManage = isOwner || isAdminFlag;
  const canDelete = isOwner || superFlag;

  // 选人信息（仅队长选人模式）
  let draftInfo = null;
  if (mode === 'captain' && t.draft && (t.status === 'draft' || t.status === 'battle')) {
    const picks = t.draft.picks || [];
    const playerRegMap = {};
    players.forEach((r) => (playerRegMap[r.openid] = r));
    const captainOrder = (t.captainOrder || []).map(decorateTeamMember);
    const turn = t.draft.turn || 0;
    const totalPicks = t.N * t.K;
    const round = Math.floor(turn / t.N) + 1;
    const inRoundIdx = turn % t.N;
    const capIdx = round % 2 === 1 ? inRoundIdx : t.N - 1 - inRoundIdx;
    const currentCaptain = turn < totalPicks ? captainOrder[capIdx] : null;
    const pickedPlayerIds = {};
    picks.forEach((arr) => arr.forEach((p) => (pickedPlayerIds[p] = true)));
    draftInfo = {
      turn,
      totalPicks,
      done: turn >= totalPicks,
      round,
      capIdx,
      currentCaptain, // {openid, nickname} | null
      captainOrder,
      picks: picks.map((arr, i) => ({
        teamIndex: i,
        captain: captainOrder[i] || null,
        players: arr.map((p) => playerRegMap[p] || decorateTeamMember({ openid: p, nickname: '队员' })),
      })),
      remainingPlayers: players.filter((p) => !pickedPlayerIds[p.openid]),
    };
  }

  // 队伍信息
  let teams = t.teams || null;
  if (!teams && t.captainOrder && t.draft) {
    teams = (t.captainOrder || []).map((cap, i) => ({
      captain: cap,
      players: (t.draft.picks || [])[i] || [],
    }));
  }
  const teamsWithCardStyles = Array.isArray(teams)
    ? teams.map((team) => Object.assign({}, team, {
        captain: decorateTeamMember(team.captain),
        players: (team.players || []).map(decorateTeamMember),
      }))
    : teams;
  const resolvedMatches = resolveBracket(t);
  const standings = calculateStandings(t, resolvedMatches, teamsWithCardStyles);
  const comments = publicComments(t, myOpenid);

  return {
    id: t._id,
    name: t.name,
    time: t.time,
    mode,
    N: t.N,
    K: t.K,
    status: t.status,
    bracketType: normalizeBracketType(t.bracketType),
    champion: t.champion || null,
    creatorName: t.creatorName || '',
    createdBy: t.createdBy || '',
    isOwner,
    isAdmin: isAdminFlag,
    canManage,
    canDelete,
    secret: canManage ? t.secret : '', // 暗号仅本场创建者或管理员可见
    myOpenid,
    isSuper: superFlag,
    captainFilled: captains.length,
    captainTotal,
    playerFilled: players.length,
    playerTotal,
    waitlistFilled: waitlist.length,
    waitLimit,
    registrations,
    myReg,
    draftInfo,
    teams: teamsWithCardStyles,
    seeding: t.seeding || null,
    standingsOrder: Array.isArray(t.standingsOrder) ? t.standingsOrder : [],
    matches: resolvedMatches,
    // 总决赛完成后才返回最终名次；比赛进行中为 null，避免客户端展示猜测名次。
    standings,
    comments,
    canComment: canPostComment(t, myOpenid, canManage),
    myComment: comments.find((comment) => comment.isMine) || null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt || t.createdAt || 0,
    archivedAt: t.archivedAt || null,
  };
}

module.exports = {
  commentOwner,
  publicComments,
  canPostComment,
  getTournamentById,
  getTournamentVersion,
  getTournamentRegistrationSnapshot,
  decorateRegistrationSnapshot,
  getRecentTournamentSummaries,
  queryHistoryPage,
  buildHistoryFilter,
  requireTournamentManager,
  getTodayCreateStats,
  normalizeBracketType,
  resolveBracket,
  composeTournament,
};
