/**
 * Dota2 群内比赛管理 - 云函数
 *
 * 所有业务逻辑都走这里（小程序端不直连数据库），
 * 身份取自微信 openid（wxContext.OPENID），天然免登录；
 * 最高管理员由环境变量指定的账号初始化；赛事权限按 createdBy（创建者）或最高管理员校验。
 *
 * 集合：users / tournaments / config（部署后通过 initializeDatabase 一次性创建）
 *  config 中存：{ key:'admins', superAdmin: openid }；旧 admins 字段仅为历史兼容数据。
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const { buildBracket } = require('./bracket');
const { calculateStandings } = require('./standings');
const { validateAutoGroups, validateAutoGroupCaptains, replaceAutoGroupMember } = require('./grouping');
const { canInitializeSuperAdmin } = require('./bootstrap');
const { dotaRankLabel, isRankVerified, publicDotaCardFields } = require('./card-profile');
const { selectUserRecord, buildUserMap } = require('./user-records');
const { ADMIN_USER_SORT_FIELDS, buildAdminUsers } = require('./admin-users');
const { buildTestRegistrationAdditions } = require('./test-registration');
const { buildRegistration, syncRegistrationProfiles } = require('./registration');
const { mutateTournament, buildRegistrationSummary, isTransactionConflict } = require('./tournament-transaction');
const { ADMIN_USER_LIST_FIELDS } = require('./query-projections');
const { TOURNAMENT_SUMMARY_FIELDS, summarize } = require('./tournament-summary');
const { TEAM_LOGO_PRESETS, TEAM_LOGO_IDS } = require('./team-logos');
const { chinaDayRange, createQuotaId, effectiveDailyCount } = require('./daily-quota');

const COLLECTIONS = ['users', 'tournaments', 'config'];
const BO_LIST = ['BO1', 'BO3', 'BO5'];
const MAX_N = 16;
const MAX_K = 5;
const DOTA_ID_RE = /^\d{5,12}$/;
const DOTA_CACHE_TTL = 5 * 60 * 1000;
const DOTA_CACHE_MAX = 500;
const DOTA_LOOKUP_LIMIT = 5;
const DOTA_LOOKUP_WINDOW = 60 * 1000;
const REGISTRATION_PROFILE_FIELDS = {
  _id: true,
  _openid: true,
  openid: true,
  nickname: true,
  mmr: true,
  roles: true,
  signature: true,
  cardStyle: true,
  dota2Id: true,
  dota2RankVerified: true,
  dota2RankTier: true,
  dota2RankVerifiedAt: true,
  dota2VerifiedAt: true,
  dota2LeaderboardRank: true,
  updatedAt: true,
  createdAt: true,
};
const dotaProfileCache = new Map();
const dotaLookupHits = new Map();
const DEFAULT_CARD_STYLE = {
  background: 'arena',
  border: 'gold',
  font: 'standard',
  color: 'gold',
  animation: 'none',
};
const CARD_STYLE_OPTIONS = {
  background: ['arena', 'dire', 'ice', 'arcane'],
  border: ['gold', 'rune', 'steel'],
  font: ['standard', 'serif', 'rune'],
  color: ['gold', 'arcane', 'frost', 'toxic', 'ember'],
  animation: ['none', 'blink', 'bkb', 'ward', 'illusion', 'roshan', 'arcane'],
};
// 赛后感言以比赛文档内嵌数组保存：每位用户一条，可重复提交更新；
// 上限和长度限制避免把比赛文档无限增大，也与 Web 版的交互保持一致。
const MAX_COMMENT_LENGTH = 100;
const MAX_COMMENTS = 100;

/* ---------------- 工具 ---------------- */

function ok(data) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message };
}

function getOpenId() {
  const wc = cloud.getWXContext();
  return wc.OPENID || '';
}

async function ensureCollections() {
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
    } catch (e) {
      const code = String(e && (e.code || e.errCode) || '').toUpperCase();
      const message = String(e && e.message || '');
      if (!/ALREADY_EXIST|COLLECTION_EXIST/.test(code) && !/already exists|集合已存在/i.test(message)) throw e;
    }
  }
}

async function updateTournamentDoc(id, update) {
  const patch = update && update.data ? update.data : update;
  return db.collection('tournaments').doc(id).update({
    data: Object.assign({}, patch || {}, { updatedAt: Date.now() }),
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getUser(openid) {
  if (!openid) return null;
  // 当前用户记录都有显式 openid；先用该索引命中常见路径，旧 owner-only
  // 数据仅在未命中时回退读取 _openid。
  const explicitResult = await db.collection('users').where({ openid }).limit(100).get();
  const explicitRecords = explicitResult.data || [];
  const owned = selectUserRecord(explicitRecords.filter((record) => record && record._openid === openid));
  if (owned) return owned;
  const ownerResult = await db.collection('users').where({ _openid: openid }).limit(100).get();
  const ownedFallback = selectUserRecord(ownerResult.data);
  if (ownedFallback) return ownedFallback;
  const legacyExplicit = selectUserRecord(explicitRecords.filter((record) =>
    record && !(typeof record._openid === 'string' && record._openid)
  ));
  return legacyExplicit;
}

function cleanDotaCache(now) {
  for (const [accountId, entry] of dotaProfileCache) {
    if (now - entry.cachedAt >= DOTA_CACHE_TTL) dotaProfileCache.delete(accountId);
  }
  while (dotaProfileCache.size >= DOTA_CACHE_MAX) {
    dotaProfileCache.delete(dotaProfileCache.keys().next().value);
  }
}

function fetchDotaProfile(accountId) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: 'api.opendota.com',
        path: '/api/players/' + accountId,
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) request.destroy(new Error('response_too_large'));
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            reject(new Error('该 ID 无公开记录（可能是私有 Profile 或 ID 错误）'));
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error('OpenDota 查询失败，请稍后重试'));
            return;
          }
          let payload;
          try {
            payload = JSON.parse(body);
          } catch (e) {
            reject(new Error('OpenDota 返回数据异常'));
            return;
          }
          const profile = payload && payload.profile;
          const rankTier = Number(payload.rank_tier) || 0;
          const rankLabel = dotaRankLabel(rankTier);
          const leaderboardValue = payload.leaderboard_rank;
          const leaderboardRank = Number.isInteger(Number(leaderboardValue)) &&
            Number(leaderboardValue) >= 1 && Number(leaderboardValue) <= 10000
            ? Number(leaderboardValue)
            : null;
          resolve({
            accountId,
            nickname: String(profile && profile.personaname || '').trim() || '未知玩家',
            rankTier,
            rankLabel,
            leaderboardRank,
          });
        });
        response.on('error', () => reject(new Error('OpenDota 查询失败，请稍后重试')));
      }
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      reject(error && error.message === 'timeout'
        ? new Error('OpenDota 查询超时，请稍后重试')
        : error && error.message === 'response_too_large'
          ? new Error('OpenDota 返回数据异常')
          : new Error('OpenDota 查询失败，请稍后重试'));
    });
  });
}

async function getDotaProfile(rawAccountId, openid) {
  const accountId = String(rawAccountId == null ? '' : rawAccountId).trim();
  if (!DOTA_ID_RE.test(accountId)) throw new Error('请输入正确的 Dota2 数字 ID（5-12 位）');
  const now = Date.now();
  const cached = dotaProfileCache.get(accountId);
  if (cached && now - cached.cachedAt < DOTA_CACHE_TTL) return Object.assign({}, cached.profile);
  if (!openid || !allowDotaLookup(openid)) throw new Error('查询太频繁，请稍后再试');
  const profile = await fetchDotaProfile(accountId);
  cleanDotaCache(Date.now());
  dotaProfileCache.set(accountId, { cachedAt: Date.now(), profile });
  return Object.assign({}, profile);
}

function allowDotaLookup(openid) {
  const now = Date.now();
  if (dotaLookupHits.size > 1000) {
    for (const [id, entry] of dotaLookupHits) {
      if (now - entry.startedAt >= DOTA_LOOKUP_WINDOW * 10) dotaLookupHits.delete(id);
    }
  }
  const previous = dotaLookupHits.get(openid);
  if (!previous || now - previous.startedAt >= DOTA_LOOKUP_WINDOW) {
    dotaLookupHits.set(openid, { startedAt: now, count: 1 });
    return true;
  }
  if (previous.count >= DOTA_LOOKUP_LIMIT) return false;
  previous.count += 1;
  return true;
}

function normalizeCardStyle(style) {
  const source = style || {};
  const result = {};
  Object.keys(DEFAULT_CARD_STYLE).forEach((field) => {
    result[field] = CARD_STYLE_OPTIONS[field].indexOf(source[field]) >= 0 ? source[field] : DEFAULT_CARD_STYLE[field];
  });
  return result;
}

function registrationDotaFields(member) {
  return publicDotaCardFields(member && member.mmr, member, null);
}

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

/* 按 openid 批量读取用户档案；兼容旧记录只保存 _openid 的用户。 */
async function getUsersByOpenids(openids, fields) {
  const ids = Array.from(new Set((openids || []).filter((id) => typeof id === 'string' && id)));
  if (!ids.length) return {};
  const chunks = [];
  for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
  // Current profile records carry both fields, so one indexed lookup normally
  // supplies the owner identity too. Query _openid only for IDs found solely in
  // legacy owner-only records (or not found at all).
  const queryUsers = (filter) => {
    let query = db.collection('users').where(filter).limit(100);
    if (fields) query = query.field(fields);
    return query.get().catch(() => ({ data: [] }));
  };
  const explicitResults = await Promise.all(chunks.map((chunk) => queryUsers({ openid: _.in(chunk) })));
  const explicitRecords = explicitResults.reduce((all, result) => all.concat(result.data || []), []);
  const ownedRecords = explicitRecords.filter((record) => record && typeof record._openid === 'string' && record._openid);
  const ownerIds = new Set(ownedRecords.map((record) => record._openid));
  const fallbackIds = ids.filter((id) => !ownerIds.has(id));
  const fallbackChunks = [];
  for (let index = 0; index < fallbackIds.length; index += 100) fallbackChunks.push(fallbackIds.slice(index, index + 100));
  const ownerResults = await Promise.all(fallbackChunks.map((chunk) => queryUsers({ _openid: _.in(chunk) })));
  const ownerRecords = ownerResults.reduce((all, result) => all.concat(result.data || []), []);
  return buildUserMap(ids, ownerRecords.concat(ownedRecords), explicitRecords);
}

async function syncTournamentRegistrations(tournament) {
  const registrations = Array.isArray(tournament && tournament.registrations)
    ? tournament.registrations
    : [];
  const profiles = await getUsersByOpenids(registrations.map((registration) => registration && registration.openid));
  const synced = syncRegistrationProfiles(registrations, profiles);
  return Object.assign({}, synced, { profiles });
}

/* 按 openid 批量读取公开名片样式；兼容旧记录只保存 _openid 的用户。 */
async function getCardStylesByOpenids(openids) {
  const users = await getUsersByOpenids(openids);
  const byOpenid = {};
  Object.keys(users).forEach((openid) => {
    byOpenid[openid] = normalizeCardStyle(users[openid].cardStyle);
  });
  return byOpenid;
}

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

/* ---------------- 最高管理员与赛事所有者权限 ---------------- */

async function getAdminsConfig() {
  const res = await db.collection('config').where({ key: 'admins' }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  return { key: 'admins', superAdmin: '' };
}

async function isSuper(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin;
}

/* 管理员判定：最高管理员或普通管理员（config.admins 列表，实时读取） */
async function isAdmin(openid) {
  if (!openid) return false;
  const cfg = await getAdminsConfig();
  if (openid === cfg.superAdmin) return true;
  return Array.isArray(cfg.admins) && cfg.admins.indexOf(openid) >= 0;
}

/* 终结性操作（删除/归档）：仅比赛创建者或最高管理员。普通管理员不可删除/归档他人比赛。 */
async function canDeleteTournament(tournament, openid) {
  if (!tournament || !openid) return false;
  if (await isSuper(openid)) return true;
  return !!tournament.createdBy && tournament.createdBy === openid;
}

/* 比赛权限：比赛创建者或管理员（超管/普通管理员）可以管理该比赛。旧赛事没有 createdBy 时，
 * 只允许管理员操作，避免把历史赛事意外开放给普通用户。 */
async function canManageTournament(tournament, openid) {
  if (!tournament || !openid) return false;
  if (await isAdmin(openid)) return true;
  return !!tournament.createdBy && tournament.createdBy === openid;
}

async function requireTournamentManager(event, includeDeleted) {
  const openid = getOpenId();
  const tournament = await getTournamentById(event && event.id, !!includeDeleted);
  if (!tournament) return { error: '比赛不存在' };
  if (!(await canManageTournament(tournament, openid))) {
    return { error: '只有比赛创建者或管理员可以操作本场比赛' };
  }
  return { tournament, openid };
}

async function getTodayCreateStats(openid, now) {
  if (!openid) return { todayCreateCount: 0, todayCreateRemaining: 5, todayCreateLimit: 5, dailyLimit: 5 };
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
    todayCreateRemaining: Math.max(0, 5 - count),
    todayCreateLimit: 5,
    dailyLimit: 5,
  };
}

/* ---------------- 对阵解析 ---------------- */

/* 解析对阵：把每个比赛的队伍源解析为实际队伍信息（含昵称），并给出显示名 */
function resolveBracket(tournament) {
  const w = {}; // matchId -> {openid, name}
  const l = {};
  const resolveSource = (src) => {
    if (!src) return null;
    if (src.type === 'team') return { openid: src.openid, name: src.name, teamIcon: src.teamIcon || '' };
    const map = src.slot === 'winner' ? w : l;
    return map[src.matchId] || null;
  };
  const ms = (tournament.matches || []).map((m) => {
    const a = resolveSource(m.teamA);
    const b = resolveSource(m.teamB);
    const item = Object.assign({}, m, {
      teamAInfo: a,
      teamBInfo: b,
      displayA: a ? a.name : '待定',
      displayB: b ? b.name : '待定',
    });
    if (m.status === 'done' && m.winner) {
      const winnerIsA = a && a.openid === m.winner;
      w[m.id] = winnerIsA ? a : b;
      l[m.id] = winnerIsA ? b : a;
    }
    return item;
  });
  return ms;
}

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

/* ---------------- 动作 ---------------- */

/* 系统分组算法：
   1) 天梯分最高的 N 人先固定为各组组长；
   2) 其余队员优先补入当前平均分较低的队伍，尽量平衡各组平均分；
   3) 只交换非组长队员做局部优化，平均分差优先，位置缺位次优；
   返回预览结构（含每组名单/均分/缺位和最高/最低平均分差）。 */
function runAutoGroup(players, N, K) {
  const has = (p, r) => Array.isArray(p.roles) && p.roles.indexOf(r) >= 0;
  const missingRoles = (g) => {
    const s = new Set();
    g.forEach((p) => (p.roles || []).forEach((r) => s.add(r)));
    const m = [];
    for (let r = 1; r <= 5; r++) if (!s.has(r)) m.push(r);
    return m;
  };
  const mmr = (p) => {
    const value = Number(p && p.mmr);
    return Number.isFinite(value) ? value : 0;
  };
  const avg = (g) => (g.length ? g.reduce((s, p) => s + mmr(p), 0) / g.length : 0);
  const source = (Array.isArray(players) ? players : []).map((p, index) => Object.assign({}, p, { _groupOrder: index }));
  const sorted = source.slice().sort((a, b) => mmr(b) - mmr(a) || a._groupOrder - b._groupOrder);
  const captains = sorted.slice(0, N);
  const pool = shuffle(sorted.slice(N));
  let groups = captains.map((captain) => [captain]);

  // 1. 组长固定后，打乱组员入组顺序（每次分组结果不同，仍以当前预计均分最低的队伍为优先），
  //    不满意可再次分组；组长始终保持为天梯分最高的前 N 名。
  pool.forEach((player) => {
    let pickIndex = -1;
    let pickScore = null;
    groups.forEach((group, index) => {
      if (group.length >= K) return;
      const missing = missingRoles(group);
      const fillsRole = missing.some((role) => has(player, role)) ? 0 : 1;
      const projected = (avg(group) * group.length + mmr(player)) / (group.length + 1);
      const score = { projected, fillsRole, size: group.length, index };
      if (!pickScore || score.projected < pickScore.projected ||
        (score.projected === pickScore.projected && score.fillsRole < pickScore.fillsRole) ||
        (score.projected === pickScore.projected && score.fillsRole === pickScore.fillsRole && score.size < pickScore.size)) {
        pickScore = score;
        pickIndex = index;
      }
    });
    if (pickIndex >= 0) groups[pickIndex].push(player);
  });

  // 2. 局部交换：组长位置固定，只接受能降低平均分极差的交换；同分时减少位置缺位。
  const score = () => {
    const averages = groups.map(avg);
    const maxAvg = averages.length ? Math.max.apply(null, averages) : 0;
    const minAvg = averages.length ? Math.min.apply(null, averages) : 0;
    const maxD = maxAvg - minAvg;
    const missN = groups.reduce((sum, group) => sum + missingRoles(group).length, 0);
    return { maxD, maxAvg, minAvg, missN };
  };
  const better = (a, b) => a.maxD < b.maxD || (a.maxD === b.maxD && a.missN < b.missN);
  let bestS = score();
  let best = groups.map((group) => group.slice());
  for (let pass = 0; pass < 16; pass++) {
    let candidate = null;
    for (let gi = 0; gi < N; gi++) {
      for (let gj = gi + 1; gj < N; gj++) {
        for (let ai = 1; ai < groups[gi].length; ai++) {
          for (let bj = 1; bj < groups[gj].length; bj++) {
            const temp = groups[gi][ai];
            groups[gi][ai] = groups[gj][bj];
            groups[gj][bj] = temp;
            const current = score();
            groups[gj][bj] = groups[gi][ai];
            groups[gi][ai] = temp;
            if (better(current, bestS) && (!candidate || better(current, candidate.score))) {
              candidate = { gi, gj, ai, bj, score: current };
            }
          }
        }
      }
    }
    if (!candidate) break;
    const temp = groups[candidate.gi][candidate.ai];
    groups[candidate.gi][candidate.ai] = groups[candidate.gj][candidate.bj];
    groups[candidate.gj][candidate.bj] = temp;
    bestS = candidate.score;
    best = groups.map((group) => group.slice());
  }
  groups = best;

  // 4. 组装输出
  const out = [];
  for (let gi = 0; gi < N; gi++) {
    const g = groups[gi].slice().sort((a, b) => mmr(b) - mmr(a) || a._groupOrder - b._groupOrder);
    out.push({
      idx: gi,
      captain: g[0] || null,
      avgMmr: Math.round(avg(g)),
      missingRoles: missingRoles(g),
      members: g.map((p) => ({
        openid: p.openid,
        nickname: p.nickname,
        mmr: p.mmr,
        ...registrationDotaFields(p),
        roles: p.roles || [],
        signature: p.signature || '',
      })),
    });
  }
  return {
    groups: out,
    maxDiff: Math.round(bestS.maxD),
    maxAvgMmr: Math.round(bestS.maxAvg),
    minAvgMmr: Math.round(bestS.minAvg),
    avgMmrDiff: Math.round(bestS.maxD),
    maxDiffOk: bestS.maxD <= 200,
  };
}

const actions = {
  /* 部署后一次性创建所需集合；普通业务请求不再执行集合初始化。 */
  async initializeDatabase() {
    const openid = getOpenId();
    const initialSuperAdminOpenid = String(process.env.INITIAL_SUPER_ADMIN_OPENID || '').trim();
    if (!canInitializeSuperAdmin(openid, '', initialSuperAdminOpenid)) {
      return fail('只有已配置的初始最高管理员可以初始化数据库');
    }
    await ensureCollections();
    return ok({ initialized: COLLECTIONS.slice() });
  },

  /* 主页数据：今天的比赛 + 之前的比赛 + 我的身份 */
  async home(event) {
    const openid = getOpenId();
    const [user, cfg] = await Promise.all([getUser(openid), getAdminsConfig()]);
    const isSuperFlag = openid === cfg.superAdmin;
    // 客户端传入"今天 0 点"的时间戳，避免云函数时区差异
    const todayStart = Number(event.todayStart) || 0;
    const todayFilter = todayStart ? { createdAt: _.gte(todayStart) } : {};
    const olderFilter = todayStart ? { createdAt: _.lt(todayStart) } : { createdAt: _.lt(0) };
    const [todayActive, todayArchived, activeOlder] = await Promise.all([
      getRecentTournamentSummaries(todayFilter, 30, openid, false),
      getRecentTournamentSummaries(todayFilter, 50, openid, true),
      getRecentTournamentSummaries(olderFilter, 50, openid),
    ]);
    const createStats = await getTodayCreateStats(openid, Date.now());
    return ok({
      user,
      // 创建入口对所有已登录用户开放；赛事操作权限由每场摘要的 canManage 控制。
      canCreate: !!openid,
      isSuper: isSuperFlag,
      hasSuper: !!cfg.superAdmin,
      ...createStats,
      // 已归档的比赛进入历史；删除的比赛不再显示。
      today: todayActive,
      older: todayArchived.concat(activeOlder).slice(0, 50),
    });
  },

  /* 查询公开的 OpenDota 资料；缓存与限频都由云函数负责。 */
  async lookupDota(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    try {
      const profile = await getDotaProfile(event.accountId, openid);
      if (!profile.rankLabel || profile.rankTier <= 0 || profile.rankLabel === '未知段位') {
        return fail('未查到段位，请先打完一场排位');
      }
      const verifiedAt = Date.now();
      return ok(Object.assign({}, profile, {
        verifiedAt,
        rankVerifiedAt: verifiedAt,
        dota2RankVerifiedAt: verifiedAt,
      }));
    } catch (e) {
      return fail(e && e.message ? e.message : 'OpenDota 查询失败，请稍后重试');
    }
  },

  /* 完善/更新资料。天梯分由用户自报；Dota 段位只有在 OpenDota 校验后才保存。 */
  async saveProfile(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const nickname = String(event.nickname || '').trim();
    if (!nickname) return fail('昵称不能为空');
    if (nickname.length > 20) return fail('昵称最多 20 个字');
    const me = await getUser(openid);
    const hasDota2Id = Object.prototype.hasOwnProperty.call(event, 'dota2Id');
    const dota2Id = hasDota2Id
      ? String(event.dota2Id == null ? '' : event.dota2Id).trim()
      : String(me && me.dota2Id || '').trim();
    if (dota2Id && !DOTA_ID_RE.test(dota2Id)) return fail('请输入正确的 Dota2 数字 ID（5-12 位）');
    // 天梯分（必填，1-20000）是用户自报数据，与 OpenDota 段位校验无关。
    const mmrRaw = String(event.mmr == null ? '' : event.mmr).trim();
    if (mmrRaw === '') return fail('请填写天梯分');
    const mmr = Number(mmrRaw);
    if (!Number.isInteger(mmr) || mmr < 1 || mmr > 20000) return fail('天梯分需在 1-20000 之间');
    // 常玩位置（必填，1-5 至少选一个）
    let roles = [];
    if (Array.isArray(event.roles)) {
      roles = Array.from(new Set(event.roles.map((v) => Number(v)).filter((v) => v >= 1 && v <= 5))).sort(
        (a, b) => a - b
      );
    }
    if (roles.length === 0) return fail('请至少选择一个常玩位置');
    // 个人签名（选填，不超过 25 个字）
    const signature = String(event.signature || '').trim();
    if (signature.length > 25) return fail('个人签名最多 25 个字');

    // 更换 Dota ID 时必须先完成 OpenDota 段位校验；清空 ID 则会同时清除段位资料。
    let dotaProfile = null;
    const hasFreshSavedRank = !!(dota2Id && me && me.dota2Id === dota2Id && isRankVerified(me));
    const rankConfirmed = event.dotaRankConfirmed === true &&
      event.dota2RankTier !== null && event.dota2RankTier !== undefined && event.dota2RankTier !== '';
    if (dota2Id && (!me || dota2Id !== String(me.dota2Id || '').trim()) && !rankConfirmed) {
      return fail('更换 Dota 2 ID 前请先完成段位校验');
    }
    if (rankConfirmed && !dota2Id) return fail('请先填写 Dota 2 ID 再进行段位校验');
    if (dota2Id && rankConfirmed) {
      try {
        dotaProfile = await getDotaProfile(dota2Id, openid);
      } catch (e) {
        return fail(e && e.message ? e.message : 'OpenDota 查询失败，请稍后重试');
      }
      if (!dotaProfile.rankTier || dotaProfile.rankLabel === '未知段位') {
        return fail('未查到段位，请先打完一场排位');
      }
      const submittedLeaderboard = event.dota2LeaderboardRank == null || event.dota2LeaderboardRank === ''
        ? null
        : Number(event.dota2LeaderboardRank);
      if (Number(event.dota2RankTier) !== dotaProfile.rankTier || submittedLeaderboard !== dotaProfile.leaderboardRank) {
        return fail('OpenDota 段位信息已变化，请重新校验');
      }
    }

    // 新昵称查重：仅当该昵称属于"别人"时拒绝（自己当前昵称、自己的旧记录不算）
    const dup = await db.collection('users').where({ nickname }).limit(1).get();
    if (dup.data && dup.data.length) {
      const dupRec = dup.data[0];
      const dupOwner = dupRec.openid || dupRec._openid || '';
      const isSelf = me ? dupRec._id === me._id : dupOwner === openid;
      if (!isSelf && dupOwner && dupOwner !== openid) return fail('该昵称已被使用，请换一个');
    }

    const savedRank = dotaProfile
      ? {
          dota2RankVerified: true,
          dota2RankTier: dotaProfile.rankTier,
          dota2RankLabel: dotaProfile.rankLabel,
          dota2LeaderboardRank: dotaProfile.leaderboardRank,
          dota2RankVerifiedAt: Date.now(),
          dota2Nickname: dotaProfile.nickname,
        }
      : hasFreshSavedRank
        ? {
            dota2RankVerified: true,
            dota2RankTier: me.dota2RankTier,
            dota2RankLabel: me.dota2RankLabel,
            dota2LeaderboardRank: me.dota2LeaderboardRank == null ? null : me.dota2LeaderboardRank,
            dota2RankVerifiedAt: me.dota2RankVerifiedAt || me.dota2VerifiedAt,
            dota2Nickname: me.dota2Nickname || '',
          }
        : {
            dota2RankVerified: false,
            dota2RankTier: null,
            dota2RankLabel: '',
            dota2LeaderboardRank: null,
            dota2RankVerifiedAt: null,
            dota2Nickname: '',
          };
    const data = {
      openid,
      nickname,
      mmr,
      roles,
      signature,
      dota2Id,
      ...savedRank,
      // Keep the legacy timestamp field for older clients while the new field
      // is used for the independent 14-day rank verification window.
      dota2VerifiedAt: savedRank.dota2RankVerifiedAt || null,
      cardStyle: normalizeCardStyle(me && me.cardStyle),
      updatedAt: Date.now(),
    };
    if (me) {
      // 更新自己的记录（改昵称 = 更新，不再新增）
      await db.collection('users').doc(me._id).update({ data });
      // 清理同 openid 的历史重复记录（只保留 me._id 这条），修复旧 bug 产生的孤儿数据
      const dupRes = await db.collection('users').where({ openid }).get();
      const dels = (dupRes.data || []).filter((r) => r._id !== me._id);
      for (const r of dels) {
        try {
          await db.collection('users').doc(r._id).remove();
        } catch (e) {
          /* 忽略并发删除 */
        }
      }
    } else {
      await db.collection('users').add({
        data: Object.assign({}, data, { createdAt: Date.now() }),
      });
    }
    return ok({ nickname, mmr, roles, signature });
  },

  /* 初始化超管：仅允许环境变量指定的账号完成首次初始化。 */
  async initSuperAdmin() {
    const openid = getOpenId();
    const initialSuperAdminOpenid = String(process.env.INITIAL_SUPER_ADMIN_OPENID || '').trim();
    if (!initialSuperAdminOpenid) return fail('云函数未配置初始超管账号，请先设置 INITIAL_SUPER_ADMIN_OPENID');
    const cfg = await getAdminsConfig();
    if (cfg.superAdmin) return fail('最高管理员已初始化');
    if (!canInitializeSuperAdmin(openid, cfg.superAdmin, initialSuperAdminOpenid)) {
      return fail('当前微信账号不是指定的初始超管账号');
    }
    const me = await getUser(openid);
    if (!me) return fail('请先设置昵称再初始化');
    const data = { superAdmin: openid, createdAt: Date.now() };
    if (cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data });
    } else {
      await db.collection('config').add({ data: Object.assign({ key: 'admins' }, data) });
    }
    return ok({ isSuper: true });
  },

  /* 最高管理员信息（所有用户可看）；超管可查看用户列表 */
  async getStaff() {
    const openid = getOpenId();
    const cfg = await getAdminsConfig();
    const ids = [cfg.superAdmin].filter(Boolean);
    const members = [];
    for (const id of ids) {
      const u = await getUser(id);
      members.push({ openid: id, nickname: u ? u.nickname : '未设置昵称' });
    }
    const user = await getUser(openid);
    if (user) user.cardStyle = normalizeCardStyle(user.cardStyle);
    return ok({
      user,
      superAdminOpenid: cfg.superAdmin,
      superAdmin: members.find((m) => m.openid === cfg.superAdmin) || null,
      isSuper: await isSuper(openid),
      isAdmin: await isAdmin(openid),
      admins: Array.isArray(cfg.admins) ? cfg.admins : [],
      bootstrapOpenid: cfg.superAdmin ? '' : openid,
      canInitializeSuperAdmin: canInitializeSuperAdmin(
        openid,
        cfg.superAdmin,
        process.env.INITIAL_SUPER_ADMIN_OPENID
      ),
    });
  },

  /* 保存自己的名片装扮；只允许白名单预设，防止任意样式值进入公开页面。 */
  async saveCardStyle(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me) return fail('请先设置个人资料');
    const incoming = event.cardStyle || event.style;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return fail('名片样式参数无效');
    const merged = Object.assign({}, me.cardStyle || {}, incoming);
    for (const field of Object.keys(DEFAULT_CARD_STYLE)) {
      if (merged[field] != null && CARD_STYLE_OPTIONS[field].indexOf(merged[field]) < 0) {
        return fail('名片样式包含不支持的选项');
      }
    }
    const cardStyle = normalizeCardStyle(merged);
    // 旧数据可能同时存在 _openid 与显式 openid 记录；同步两类记录，避免样式读取到另一条旧记录。
    const [explicitRes, ownerRes] = await Promise.all([
      db.collection('users').where({ openid }).limit(100).get().catch(() => ({ data: [] })),
      db.collection('users').where({ _openid: openid }).limit(100).get().catch(() => ({ data: [] })),
    ]);
    const records = [];
    const seen = {};
    [me].concat(explicitRes.data || [], ownerRes.data || []).forEach((record) => {
      if (record && record._id && !seen[record._id]) {
        seen[record._id] = true;
        records.push(record);
      }
    });
    await Promise.all(records.map((record) => db.collection('users').doc(record._id).update({ data: { cardStyle, updatedAt: Date.now() } })));
    return ok({ cardStyle });
  },

  /* 批量读取公开样式，用于领奖台或队伍列表等需要一次显示多张名片的页面。 */
  async getCardStyles(event) {
    const openids = Array.isArray(event.openids) ? Array.from(new Set(event.openids.filter(
      (id) => typeof id === 'string' && id.trim() && id.length <= 128
    ))) : [];
    if (openids.length > 100) return fail('一次最多读取 100 位用户的名片样式');
    return ok({ cardStyles: await getCardStylesByOpenids(openids) });
  },

  /* 超管：分页管理所有用户，排序按 Dota ID / 天梯分 / 用户名 / 已校验段位。 */
  async listUsers(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以查看用户列表');
    const cfg = await getAdminsConfig();
    const page = Math.max(1, Math.floor(Number(event.page) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)));
    const sortBy = ADMIN_USER_SORT_FIELDS.indexOf(event.sortBy) >= 0 ? event.sortBy : 'nickname';
    const order = event.order === 'desc' ? 'desc' : 'asc';
    const records = [];
    let offset = 0;
    while (true) {
      const result = await db.collection('users')
        .field(ADMIN_USER_LIST_FIELDS)
        .orderBy('_id', 'asc')
        .skip(offset)
        .limit(100)
        .get();
      const batch = result.data || [];
      records.push(...batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }
    const sortedUsers = buildAdminUsers(records, cfg.superAdmin, sortBy, order);
    const start = (page - 1) * pageSize;
    const users = sortedUsers.slice(start, start + pageSize);
    return ok({
      users,
      admins: Array.isArray(cfg.admins) ? cfg.admins : [],
      page,
      pageSize,
      total: sortedUsers.length,
      hasMore: start + users.length < sortedUsers.length,
      sortBy,
      order,
    });
  },

  /* 超管：全量设置普通管理员列表（≤ 20 人；去重、过滤空、排除超管自身；幂等）。 */
  async setAdmins(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以设置普通管理员');
    const list = Array.isArray(event.openids) ? event.openids : [];
    const seen = new Set();
    const deduped = [];
    list.forEach((value) => {
      const item = String(value || '').trim();
      if (item && item !== openid && !seen.has(item)) {
        seen.add(item);
        deduped.push(item);
      }
    });
    if (deduped.length > 20) return fail('普通管理员最多 20 人');
    const cfg = await getAdminsConfig();
    const update = { admins: deduped, updatedAt: Date.now() };
    if (cfg && cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data: update });
    } else {
      await db.collection('config').add({
        data: Object.assign({ key: 'admins', superAdmin: cfg.superAdmin || '', createdAt: Date.now() }, update),
      });
    }
    return ok({ admins: deduped });
  },

  /* 创建比赛（所有用户）：每日最多两场，报名需暗号 */
  async createTournament(event) {
    const name = String(event.name || '').trim();
    const time = String(event.time || '').trim();
    const secret = String(event.secret || '').trim();
    const mode = event.mode === 'auto' ? 'auto' : 'captain'; // captain=队长选人 auto=系统分组
    const N = Number(event.N);
    const K = Number(event.K);
    const waitLimit = Number(event.waitLimit);
    if (!name) return fail('请填写比赛名称');
    if (!secret) return fail('请设置报名暗号');
    if (secret.length > 20) return fail('暗号最多 20 个字');
    if (N < 2 || N > MAX_N) return fail('队伍数量需在 2-' + MAX_N + ' 之间');
    if (K < 1 || K > MAX_K) return fail(mode === 'auto' ? '每组人数需在 1-' + MAX_K + ' 之间' : '每个队长选队友数量需在 1-' + MAX_K + ' 之间');
    if (!isFinite(waitLimit) || waitLimit < 0 || waitLimit > 20) return fail('替补数量需在 0-20 之间');
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const me = await getUser(openid);
    const now = Date.now();
    const range = chinaDayRange(now);
    const quotaId = createQuotaId(openid, range.dayKey);
    const tournamentData = {
      name,
      time,
      secret,
      mode,
      N,
      K,
      waitLimit: Math.round(waitLimit),
      status: 'registration',
      registrations: [],
      ...buildRegistrationSummary([]),
      captainOrder: [],
      draft: null,
      teams: [],
      seeding: null,
      matches: [],
      champion: null,
      comments: [],
      createdAt: now,
      updatedAt: now,
      createdBy: openid,
      creatorName: me ? me.nickname : '',
    };
    let result = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        result = await db.runTransaction(async (transaction) => {
        const quotaRef = transaction.collection('config').doc(quotaId);
        const quotaResult = await transaction.collection('config').where({ _id: quotaId }).limit(1).get();
        const quota = quotaResult && quotaResult.data && quotaResult.data.length ? quotaResult.data[0] : null;
        const existing = await transaction.collection('tournaments')
          .where({ createdBy: openid, createdAt: _.gte(range.start).and(_.lt(range.end)) })
          .limit(3)
          .get();
        const existingCount = (existing && existing.data || []).length;
        const used = effectiveDailyCount(quota && quota.count, existingCount);
        if (used >= 5) return { error: '每位用户每天最多创建 5 场比赛' };
        const tournament = await transaction.collection('tournaments').add({ data: tournamentData });
        const quotaData = {
          key: 'createQuota',
          openid,
          dayKey: range.dayKey,
          count: used + 1,
          updatedAt: now,
        };
        if (quota && quota._id) {
          await quotaRef.update({ data: quotaData });
        } else {
          await quotaRef.set({ data: Object.assign({ createdAt: now }, quotaData) });
        }
        return { id: tournament._id, count: used + 1 };
        });
        break;
      } catch (e) {
        if (isTransactionConflict(e) && attempt < 5) continue;
        console.error('create tournament failed:', e);
        return fail('创建比赛失败，请稍后重试');
      }
    }
    if (result && result.error) return fail(result.error);
    return ok({
      id: result.id,
      todayCreateCount: result.count,
      todayCreateRemaining: Math.max(0, 5 - result.count),
      todayCreateLimit: 5,
      dailyLimit: 5,
    });
  },

  /* 比赛创建者或管理员：修改报名阶段的比赛配置 */
  async updateConfig(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const name = String(event.name || '').trim();
    const time = String(event.time || '').trim();
    const secret = String(event.secret || '').trim();
    const mode = event.mode === 'auto' ? 'auto' : 'captain';
    const N = Number(event.N);
    const K = Number(event.K);
    const waitLimit = Number(event.waitLimit);
    if (!name) return fail('请填写比赛名称');
    if (!secret) return fail('请设置报名暗号');
    if (secret.length > 20) return fail('暗号最多 20 个字');
    if (N < 2 || N > MAX_N) return fail('队伍数量需在 2-' + MAX_N + ' 之间');
    if (K < 1 || K > MAX_K) return fail(mode === 'auto' ? '每组人数需在 1-' + MAX_K + ' 之间' : '每个队长选队友数量需在 1-' + MAX_K + ' 之间');
    if (!isFinite(waitLimit) || waitLimit < 0 || waitLimit > 20) return fail('替补数量需在 0-20 之间');
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以修改配置' };
      const registrations = Array.isArray(t.registrations) ? t.registrations : [];
      const captains = registrations.filter((r) => r.role === 'captain').length;
      const players = registrations.filter((r) => r.role === 'player').length;
      const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
      if (mode === 'auto') {
        if (captains > 0) return { error: '已有队长报名，不能切换为系统分组模式（请先移除队长报名）' };
        if (N * K < players) return { error: '队员名额不能小于已报名人数（当前已报 ' + players + ' 人）' };
      } else {
        if (N < captains) return { error: '已有 ' + captains + ' 位队长报名，队长数不能小于 ' + captains };
        if (N * K < players) return { error: '队员名额不能小于已报名人数（当前已报 ' + players + ' 人）' };
      }
      if (waitLimit < waitlist) return { error: '替补名额不能小于已报名替补人数（当前 ' + waitlist + ' 人）' };
      return {
        data: { name, time, secret, mode, N, K, waitLimit: Math.round(waitLimit) },
        result: {},
      };
    });
    return result.error ? fail(result.error) : ok({});
  },

  /* 报名暗号校验 */
  async checkSecret(event) {
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    return ok({ correct: String(event.secret || '') === String(t.secret || '') });
  },

  /* 最高管理员：仅补足当前报名缺口，用于验证完整报名与选人流程。 */
  async fillTestRegistrations(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以补充测试报名数据');
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以补充测试数据' };
      const additions = buildTestRegistrationAdditions(t, Date.now());
      if (!additions.additions.length) {
        return { result: { added: 0, counts: additions.counts, targets: additions.targets } };
      }
      return {
        data: { registrations: (t.registrations || []).concat(additions.additions) },
        result: { added: additions.additions.length, counts: additions.counts, targets: additions.targets },
      };
    });
    return result.error ? fail(result.error) : ok(result.result);
  },

  /* 报名（需暗号）：队长/队员/替补；队员满时自动进入替补；资料（昵称/天梯分/常玩位置）必填才可报名 */
  async register(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me || !me.nickname) return fail('请先设置昵称');
    if (me.mmr == null) return fail('请先在「我的-编辑资料」填写天梯分后再报名');
    if (!Array.isArray(me.roles) || me.roles.length === 0) return fail('请先在「我的-编辑资料」选择常玩位置后再报名');
    const skipSecret = await isAdmin(openid);
    const result = await mutateTournament(db, event.id, (t) => {
      const registration = buildRegistration(
        t, openid, me, event.role, event.secret, registrationDotaFields(me), Date.now(), skipSecret
      );
      if (registration.error) return registration;
      return { data: { registrations: registration.registrations }, result: registration.result };
    });
    return result.error ? fail(result.error) : ok(Object.assign({}, result.result, { updatedAt: result.updatedAt }));
  },

  /* 队伍改名后同步对阵快照：晋级图/赛程列表按 match.teamX 的 name/teamIcon 展示，需与新队名一致 */
  syncMatchNames(t, teamIndex, captain) {
    const seeding = Array.isArray(t.seeding) ? t.seeding : (t.teams || []).map((_, i) => i);
    const slot = seeding.indexOf(teamIndex);
    const slotOpenid = 'T' + (slot >= 0 ? slot : teamIndex);
    return (t.matches || []).map((m) => {
      const nm = Object.assign({}, m);
      ['teamA', 'teamB'].forEach((side) => {
        const src = nm[side];
        if (src && src.type === 'team' && src.openid === slotOpenid) {
          nm[side] = Object.assign({}, src, { name: captain.teamName || '', teamIcon: captain.teamIcon || '' });
        }
      });
      return nm;
    });
  },

  /* 设置队伍名称（队长本人/组长本人或本场比赛管理者；最多 10 个字） */
  async setTeamName(event) {
    const openid = getOpenId();
    const teamName = String(event.teamName || '').trim();
    if (teamName.length > 10) return fail('队伍名称最多 10 个字');
    const hasTeamIcon = Object.prototype.hasOwnProperty.call(event, 'teamIcon');
    const teamIcon = hasTeamIcon ? String(event.teamIcon || '').trim() : null;
    if (hasTeamIcon && teamIcon && TEAM_LOGO_IDS.indexOf(teamIcon) < 0) return fail('请选择内置队标');
    const targetOpenid = String(event.openid || '') || openid;
    const currentTournament = await getTournamentById(event.id);
    if (!currentTournament) return fail('比赛不存在');
    const manager = await canManageTournament(currentTournament, openid);
    if (targetOpenid !== openid && !manager) return fail('只有队长本人或比赛创建者、最高管理员可以设置队伍名称');
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode === 'auto') {
        if (t.status !== 'draft' && t.status !== 'battle') return { error: '只有分组完成后可以设置队伍名称' };
        const teams = (t.teams || []).map((tm) => Object.assign({}, tm));
        const ti = teams.findIndex((tm) => tm.captain && tm.captain.openid === targetOpenid);
        if (ti < 0) return { error: '只能由组长（本队天梯分最高者）或本场比赛管理者设置队伍名称' };
        teams[ti] = Object.assign({}, teams[ti], {
          captain: Object.assign({}, teams[ti].captain, Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {})),
        });
        return { data: { teams, matches: actions.syncMatchNames(t, ti, teams[ti].captain) }, result: true };
      }
      if (t.status === 'registration') {
        const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
        const idx = registrations.findIndex((r) => r.openid === targetOpenid && r.role === 'captain');
        if (idx < 0) return { error: '只能为已报名的队长设置队伍名称' };
        registrations[idx] = Object.assign({}, registrations[idx], Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {}));
        return { data: { registrations }, result: true };
      }
      if (t.status === 'draft' || t.status === 'battle') {
        const teams = (t.teams || []).map((tm) => Object.assign({}, tm));
        const ti = teams.findIndex((tm) => tm.captain && tm.captain.openid === targetOpenid);
        if (ti < 0) return { error: '只能由本队队长或本场比赛管理者设置队伍名称' };
        teams[ti] = Object.assign({}, teams[ti], {
          captain: Object.assign({}, teams[ti].captain, Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {})),
        });
        return { data: { teams, matches: actions.syncMatchNames(t, ti, teams[ti].captain) }, result: true };
      }
      return { error: '当前阶段不能设置队伍名称' };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 比赛创建者或管理员：报名阶段把队员移入替补 / 替补移回队员 */
  async moveRegistration(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const toRole = event.toRole === 'player' ? 'player' : 'waitlist';
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以调整名单' };
      const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
      const idx = registrations.findIndex((r) => r.openid === event.openid);
      if (idx < 0) return { error: '未找到该报名' };
      const cur = registrations[idx];
      if (cur.role !== 'player' && cur.role !== 'waitlist') return { error: '只能调整队员/替补' };
      if (cur.role === toRole) return { error: '该用户已在目标名单中' };
      if (toRole === 'player') {
        const players = registrations.filter((r) => r.role === 'player').length;
        if (players >= t.N * t.K) return { error: '队员名额已满，无法移入' };
      } else {
        const waitLimit = t.waitLimit || 0;
        if (waitLimit <= 0) return { error: '本场比赛未设置替补' };
        const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
        if (waitlist >= waitLimit) return { error: '替补名额已满' };
      }
      registrations[idx] = Object.assign({}, cur, { role: toRole });
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 退报（报名阶段自己取消） */
  async cancelRegister(event) {
    const openid = getOpenId();
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '报名已锁定，请联系本场比赛创建者或管理员' };
      const current = Array.isArray(t.registrations) ? t.registrations : [];
      const registrations = current.filter((r) => r.openid !== openid);
      if (registrations.length === current.length) return { error: '你尚未报名' };
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 移除报名（比赛创建者或最高管理员） */
  async removeRegistration(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const result = await mutateTournament(db, event.id, (t) => {
      const current = Array.isArray(t.registrations) ? t.registrations : [];
      const registrations = current.filter((r) => r.openid !== event.openid);
      if (registrations.length === current.length) return { error: '未找到该报名' };
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 开始选人（比赛创建者或最高管理员）：随机排序队长，初始化蛇形轮次 */
  async startDraft(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '当前不在报名阶段' };
      const registrations = Array.isArray(t.registrations) ? t.registrations : [];
      const captains = registrations.filter((r) => r.role === 'captain');
      const players = registrations.filter((r) => r.role === 'player');
      if (captains.length < t.N) return { error: '队长尚未报满（' + captains.length + '/' + t.N + '）' };
      if (players.length < t.N * t.K) return { error: '队员尚未报满（' + players.length + '/' + t.N * t.K + '）' };
      const captainOrder = shuffle(captains).map((c) => ({
        openid: c.openid,
        nickname: c.nickname,
        teamName: c.teamName || '',
        teamIcon: c.teamIcon || '',
        mmr: c.mmr || null,
        ...registrationDotaFields(c),
        roles: c.roles || [],
        signature: c.signature || '',
      }));
      return {
        data: {
          status: 'draft',
          captainOrder,
          draft: _.set({ turn: 0, picks: captainOrder.map(() => []) }),
        },
        result: true,
      };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 队长选人 / 比赛创建者或最高管理员代选 */
  async pickPlayer(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const canManage = await canManageTournament(t, openid);
    if (t.status !== 'draft') return fail('当前不在选人阶段');
    const playerOpenid = event.playerOpenid;
    if (!playerOpenid) return fail('缺少被选队员');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const target = players.find((r) => r.openid === playerOpenid);
    if (!target) return fail('该用户不是本次比赛队员');
    const picks = (t.draft.picks || []).slice();
    for (const arr of picks) {
      if (arr.indexOf(playerOpenid) >= 0) return fail('该队员已被选择');
    }
    const turn = t.draft.turn || 0;
    const totalPicks = t.N * t.K;
    if (turn >= totalPicks) return fail('选人已经完成');
    const round = Math.floor(turn / t.N) + 1;
    const inRoundIdx = turn % t.N;
    const capIdx = round % 2 === 1 ? inRoundIdx : t.N - 1 - inRoundIdx;
    const currentCaptain = (t.captainOrder || [])[capIdx];
    if (!currentCaptain) return fail('队长信息缺失，请刷新');
    if (openid !== currentCaptain.openid && !canManage) {
      return fail('还没轮到你选人（当前是' + currentCaptain.nickname + '）');
    }
    const nextPicks = picks.slice();
    nextPicks[capIdx] = (nextPicks[capIdx] || []).concat([playerOpenid]);
    // 乐观并发：只允许在 turn 仍等于当前值时更新
    const upd = await db
      .collection('tournaments')
      .where({ _id: t._id, 'draft.turn': turn })
      .update({
        data: {
          'draft.turn': turn + 1,
          ['draft.picks.' + capIdx]: nextPicks[capIdx],
          updatedAt: Date.now(),
        },
      });
    if (!upd.stats || upd.stats.updated !== 1) {
      return fail('选人顺序有冲突，请刷新后再试');
    }
    const done = turn + 1 >= totalPicks;
    return ok({ picked: playerOpenid, teamIndex: capIdx, done });
  },

  /* 重置选人（比赛创建者或最高管理员）：重新随机队长顺序并清空已选 */
  async resetDraft(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在选人阶段');
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const captainOrder = shuffle(captains).map((c) => ({
      openid: c.openid,
      nickname: c.nickname,
      teamName: c.teamName || '',
      teamIcon: c.teamIcon || '',
      mmr: c.mmr || null,
      ...registrationDotaFields(c),
      roles: c.roles || [],
      signature: c.signature || '',
    }));
    await updateTournamentDoc(t._id, {
      data: {
        captainOrder,
        draft: _.set({ turn: 0, picks: captainOrder.map(() => []) }),
      },
    });
    return ok(true);
  },

  /* 调整胜者组第一轮对阵（比赛创建者或最高管理员） */
  async setSeeding(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    if (t.mode !== 'auto') {
      const totalPicks = t.N * t.K;
      if (!t.draft || (t.draft.turn || 0) < totalPicks) return fail('选人还未完成');
    }
    const seeding = event.seeding;
    if (!Array.isArray(seeding) || seeding.length !== t.N) return fail('对阵落位数据不正确');
    const seen = {};
    for (const v of seeding) {
      if (typeof v !== 'number' || v < 0 || v >= t.N || seen[v]) return fail('对阵落位数据不正确');
      seen[v] = true;
    }
    await updateTournamentDoc(t._id, { data: { seeding } });
    return ok(true);
  },

  /* 随机对阵 */
  async shuffleSeeding(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    const base = [];
    for (let i = 0; i < t.N; i++) base.push(i);
    await updateTournamentDoc(t._id, { data: { seeding: shuffle(base) } });
    return ok(true);
  },

  /* 生成对阵、进入对战阶段（比赛创建者或最高管理员） */
  async startBracket(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    let teams;
    if (t.mode === 'auto') {
      // 系统分组：队伍已在分组确认时写入，无选人环节
      teams = t.teams || [];
      if (!teams.length) return fail('队伍尚未生成（请先完成系统分组）');
    } else {
      const totalPicks = t.N * t.K;
      if (!t.draft || (t.draft.turn || 0) < totalPicks) return fail('选人还未完成');
      const captainOrder = t.captainOrder || [];
      const picks = t.draft.picks || [];
      const playerRegMap = {};
      (t.registrations || [])
        .filter((r) => r.role === 'player')
        .forEach((r) => (playerRegMap[r.openid] = r));
      teams = captainOrder.map((cap, i) => ({
        captain: cap,
        players: (picks[i] || []).map((p) => playerRegMap[p] || { openid: p, nickname: '队员' }),
      }));
    }
    const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : shuffle(teams.map((_, i) => i));
    const ordered = seeding.map((idx) => teams[idx]);
    const bracketTeams = ordered.map((team, i) => ({
      openid: 'T' + i,
      name: (team.captain.teamName || '').trim() ? team.captain.teamName : team.captain.nickname + '战队',
      teamIcon: team.captain.teamIcon || '',
      captainOpenid: team.captain.openid,
    }));
    let matches;
    try {
      matches = buildBracket(bracketTeams);
    } catch (e) {
      return fail('生成对阵失败：' + e.message);
    }
    await updateTournamentDoc(t._id, {
      data: {
        status: 'battle',
        teams,
        seeding,
        matches,
        champion: null,
      },
    });
    return ok(true);
  },

  /* 配置比赛赛制（比赛创建者或最高管理员） */
  async setMatchBo(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const bo = BO_LIST.indexOf(event.bo) >= 0 ? event.bo : null;
    if (!bo) return fail('赛制只能是 BO1 / BO3 / BO5');
    const idx = (t.matches || []).findIndex((m) => m.id === Number(event.matchId));
    if (idx < 0) return fail('比赛不存在');
    if (t.matches[idx].status === 'done') return fail('比赛已结束，不能修改赛制');
    const matches = (t.matches || []).slice();
    matches[idx] = Object.assign({}, matches[idx], { bo });
    await updateTournamentDoc(t._id, { data: { matches } });
    return ok(true);
  },

  /* 记录比赛结果（比赛创建者或最高管理员） */
  async setMatchResult(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const matchId = Number(event.matchId);
    const idx = (t.matches || []).findIndex((m) => m.id === matchId);
    if (idx < 0) return fail('比赛不存在');
    const m = t.matches[idx];
    if (m.status === 'done') return fail('该场已有结果，请先修正再重记');

    // 解析本场实际对阵
    const resolved = resolveBracket(t);
    const rm = resolved[idx];
    if (!rm.teamAInfo || !rm.teamBInfo) return fail('本场对阵尚未完整（有待定队伍）');
    const winner = event.winner;
    if (winner !== rm.teamAInfo.openid && winner !== rm.teamBInfo.openid) {
      return fail('胜方必须是本场比赛的两支队伍之一');
    }
    const winnerIsA = winner === rm.teamAInfo.openid;
    let scoreA = event.scoreA == null ? null : Number(event.scoreA);
    let scoreB = event.scoreB == null ? null : Number(event.scoreB);
    if (m.bo === 'BO1') {
      scoreA = winnerIsA ? 1 : 0;
      scoreB = winnerIsA ? 0 : 1;
    } else {
      const winScore = m.bo === 'BO3' ? 2 : 3;
      if (scoreA == null || scoreB == null) {
        scoreA = winnerIsA ? winScore : 0;
        scoreB = winnerIsA ? 0 : winScore;
      } else {
        if (scoreA < 0 || scoreB < 0 || scoreA > winScore || scoreB > winScore) {
          return fail('比分不合法（BO' + (m.bo === 'BO3' ? '3' : '5') + ' 单方最高 ' + winScore + '）');
        }
        if (scoreA === scoreB) return fail('比分不能打平');
        if ((scoreA > scoreB) !== winnerIsA) return fail('比分与胜方不一致');
      }
    }

    const matches = (t.matches || []).slice();
    const idx2 = matches.findIndex((x) => x.id === matchId);
    matches[idx2] = Object.assign({}, matches[idx2], { status: 'done', winner, scoreA, scoreB });

    const winTeam = winnerIsA ? rm.teamAInfo : rm.teamBInfo;

    let champion = null;
    let status = t.status;
    if (m.isChampionMatch) {
      champion = winTeam;
      status = 'finished';
    }

    // 用 _.set 整体替换 champion 字段：TCB 的 update 会把嵌套对象展开成点路径（champion.name）
    // 而库里 champion 字段可能是 null（此前非冠军赛写入过 null），点路径更新会报
    // "Cannot create field 'name' in element {champion: null}"
    await updateTournamentDoc(t._id, {
      data: {
        matches,
        champion: _.set(champion),
        status,
        // 决赛打完标记已结束，但**不自动归档**：由创建者或最高管理员手动归档
        archivedAt: t.archivedAt || null,
      },
    });
    return ok({ champion: champion ? champion.name : null, finished: status === 'finished' });
  },

  /* 修正比赛结果（比赛创建者或最高管理员） */
  async resetMatchResult(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    const matchId = Number(event.matchId);
    const idx = (t.matches || []).findIndex((m) => m.id === matchId);
    if (idx < 0) return fail('比赛不存在');
    const m = t.matches[idx];
    if (m.status !== 'done') return fail('该场比赛还没有结果');

    const matches = (t.matches || []).map((x) => Object.assign({}, x));
    const resetIds = new Set();
    const queue = [matchId];
    while (queue.length) {
      const id = queue.shift();
      if (resetIds.has(id)) continue;
      resetIds.add(id);
      const cur = matches.find((x) => x.id === id);
      if (cur && cur.status === 'done') {
        if (cur.next) queue.push(cur.next.matchId);
        if (cur.loserNext) queue.push(cur.loserNext.matchId);
      }
    }
    for (const id of resetIds) {
      const i = matches.findIndex((x) => x.id === id);
      if (i >= 0) {
        matches[i] = Object.assign({}, matches[i], {
          status: 'pending',
          winner: null,
          scoreA: null,
          scoreB: null,
        });
      }
    }
    const champion = t.champion;
    let status = t.status;
    if (champion && Array.from(resetIds).some((id) => (matches.find((x) => x.id === id) || {}).isChampionMatch)) {
      status = 'battle';
    }
    await updateTournamentDoc(t._id, {
      data: {
        matches,
        champion: _.set(status === 'battle' ? null : champion),
        status,
        // 名次是依据整套赛果计算的；任意一场重置后都必须丢弃旧的人工排序。
        standingsOrder: [],
        archivedAt: status === 'battle' ? null : t.archivedAt || null,
      },
    });
    return ok(true);
  },

  /* 比赛创建者或管理员退回比赛阶段；只清除当前阶段之后的数据。 */
  async rollbackStage(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.archivedAt || t.status === 'finished') return fail('已结束或归档的比赛不能调整阶段');
    if (t.status === 'registration') return fail('当前已经在报名阶段');
    const target = event.stage === 'draft' || event.stage === 'registration' ? event.stage : '';
    if (!target) return fail('目标阶段无效');
    if (t.status === 'draft' && target !== 'registration') return fail('选人/分组阶段只能退回报名阶段');
    if (t.status !== 'draft' && t.status !== 'battle') return fail('当前状态不能调整阶段');

    const data = { status: target, standingsOrder: [], updatedAt: Date.now() };
    if (target === 'registration') {
      Object.assign(data, {
        captainOrder: [],
        draft: null,
        teams: [],
        seeding: null,
        matches: [],
        champion: _.set(null),
        archivedAt: null,
      });
    } else {
      // 对战退回选人时保留草稿进度或系统分组，只清除赛程和落位。
      Object.assign(data, {
        seeding: null,
        matches: [],
        champion: _.set(null),
        archivedAt: null,
      });
      if (t.mode !== 'auto') data.teams = _.set(null);
    }
    await updateTournamentDoc(t._id, { data });
    return ok({ status: target });
  },

  /* 比赛创建者或管理员在选人或对战阶段替换队员。 */
  async replacePlayer(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    const teamIndex = Number(event.teamIndex);
    const outOpenid = String(event.outOpenid || '').trim();
    const inOpenid = String(event.inOpenid || '').trim();
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || !outOpenid || !inOpenid || outOpenid === inOpenid) {
      return fail('替换队员参数无效');
    }
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'draft' && t.status !== 'battle') return { error: '仅选人/分组或对战阶段可以替换队员' };
      if ((t.matches || []).some((match) => match.status === 'done')) return { error: '已有比赛记录比分，不能再替换队员' };

      const captainDraft = t.status === 'draft' && t.mode !== 'auto';
      if (captainDraft) {
        const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
        if (teamIndex >= picks.length) return { error: '队伍索引无效' };
        const outIndex = picks[teamIndex].indexOf(outOpenid);
        if (outIndex < 0) return { error: '该队员不在此队伍' };
        if (picks.some((team) => team.indexOf(inOpenid) >= 0)) return { error: '该队员已被其他队伍选中' };
        const registrations = t.registrations || [];
        if (!registrations.some((registration) => registration.openid === inOpenid && registration.role === 'player')) {
          return { error: '换入队员不在未选队员池' };
        }
        picks[teamIndex][outIndex] = inOpenid;
        return {
          data: { draft: Object.assign({}, t.draft, { picks }) },
          result: { outOpenid, inOpenid },
        };
      }

      const teams = (t.teams || []).map((team) => Object.assign({}, team, { players: (team.players || []).slice() }));
      if (teamIndex >= teams.length) return { error: '队伍索引无效' };
      const team = teams[teamIndex];
      const captain = team.captain;
      const captainOpenid = typeof captain === 'string' ? captain : captain && captain.openid;
      const memberOpenid = (member) => typeof member === 'string' ? member : member && member.openid;
      const registrations = (t.registrations || []).map((registration) => Object.assign({}, registration));
      const outRegistration = registrations.find((registration) => registration.openid === outOpenid && registration.role === 'player');
      const inRegistration = registrations.find((registration) => registration.openid === inOpenid && registration.role === 'waitlist');
      if (!outRegistration) return { error: '换下队员资料已失效' };
      if (!inRegistration) return { error: '换入用户不在替补池' };

      if (t.mode === 'auto') {
        const replaced = replaceAutoGroupMember(team, registrations, outOpenid, inOpenid, {
          openid: inRegistration.openid,
          nickname: inRegistration.nickname,
          mmr: inRegistration.mmr,
          ...registrationDotaFields(inRegistration),
          roles: inRegistration.roles || [],
          signature: inRegistration.signature || '',
        });
        if (replaced.error) return { error: replaced.error };
        teams[teamIndex] = replaced.team;
        return {
          data: { teams, registrations: replaced.registrations },
          result: { outOpenid, inOpenid, outNickname: replaced.outNickname, inNickname: replaced.inNickname, captainOpenid: replaced.captainOpenid },
        };
      }

      if (captainOpenid === outOpenid) return { error: '队长不能被替换' };
      const outIndex = team.players.findIndex((member) => memberOpenid(member) === outOpenid);
      if (outIndex < 0) return { error: '该队员不在此队伍' };

      const outNickname = outRegistration.nickname;
      team.players.splice(outIndex, 1, {
        openid: inRegistration.openid,
        nickname: inRegistration.nickname,
        mmr: inRegistration.mmr,
        ...registrationDotaFields(inRegistration),
        roles: inRegistration.roles || [],
        signature: inRegistration.signature || '',
      });
      outRegistration.role = 'waitlist';
      inRegistration.role = 'player';
      return {
        data: { teams, registrations },
        result: { outOpenid, inOpenid, outNickname, inNickname: inRegistration.nickname },
      };
    });
    return result.error ? fail(result.error) : ok(result.result);
  },

  /* 结束并归档（比赛创建者或最高管理员；普通管理员不可归档） */
  async finishTournament(event) {
    const openid = getOpenId();
    const tournament = await getTournamentById(event && event.id, false);
    if (!tournament) return fail('比赛不存在');
    if (!(await canDeleteTournament(tournament, openid))) {
      return fail('只有比赛创建者或最高管理员可以结束并归档比赛');
    }
    const t = tournament;
    if (t.archivedAt) return fail('比赛已归档');
    if (!t.champion) return fail('比赛还未结束（未产生冠军），不能归档');
    await updateTournamentDoc(t._id, {
      data: { status: 'finished', archivedAt: Date.now() },
    });
    return ok(true);
  },

  /* 比赛创建者或管理员微调结算名次。 */
  async setStandingsOrder(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'finished' || !t.champion) return fail('比赛结束后才能调整名次');
    if (t.archivedAt) return fail('已归档比赛不能调整名次');
    const automatic = calculateStandings(t, resolveBracket(t), t.teams);
    if (!automatic || !automatic.complete) return fail('当前赛果不完整，无法调整名次');
    const requested = Array.isArray(event.order) ? event.order : null;
    if (!requested) return fail('名次列表格式无效');
    let order = [];
    if (requested.length) {
      const valid = new Set(automatic.items.map((item) => item.teamId));
      const seen = new Set();
      for (const value of requested) {
        const teamId = String(value || '');
        if (!valid.has(teamId) || seen.has(teamId)) return fail('名次列表包含无效或重复队伍');
        seen.add(teamId);
        order.push(teamId);
      }
      if (order.length !== valid.size) return fail('名次列表必须包含本场所有队伍');
    }
    await updateTournamentDoc(t._id, { data: { standingsOrder: order, updatedAt: Date.now() } });
    return ok({ standingsOrder: order });
  },

  /* 删除比赛（创建者或超管；普通管理员不可删除他人比赛）：永久删除。 */
  async deleteTournament(event) {
    const openid = getOpenId();
    const tournament = await getTournamentById(event && event.id, true);
    if (!tournament) return fail('比赛不存在');
    if (!(await canDeleteTournament(tournament, openid))) {
      return fail('只有比赛创建者或最高管理员可以删除比赛');
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const result = await db.runTransaction(async (transaction) => {
          const tournamentRef = transaction.collection('tournaments').doc(tournament._id);
          const latestResult = await tournamentRef.get();
          const latest = latestResult && latestResult.data;
          if (!latest) return { error: '比赛不存在' };
          if (!(await canDeleteTournament(latest, openid))) {
            return { error: '只有比赛创建者或最高管理员可以删除比赛' };
          }

          // Keep today's quota after a permanent delete. This also accounts for
          // same-day matches that existed before quota tracking was introduced.
          const ownerOpenid = latest.createdBy;
          const range = chinaDayRange(Date.now());
          const createdAt = Number(latest.createdAt) || 0;
          if (ownerOpenid && createdAt >= range.start && createdAt < range.end) {
            const quotaId = createQuotaId(ownerOpenid, range.dayKey);
            const quotaRef = transaction.collection('config').doc(quotaId);
            let quota = null;
            try {
              const quotaResult = await quotaRef.get();
              quota = quotaResult && quotaResult.data;
            } catch (e) {
              quota = null;
            }
            const existing = await transaction.collection('tournaments')
              .where({ createdBy: ownerOpenid, createdAt: _.gte(range.start).and(_.lt(range.end)) })
              .limit(3)
              .get();
            const used = effectiveDailyCount(quota && quota.count, (existing && existing.data || []).length);
            const quotaData = {
              key: 'createQuota',
              openid: ownerOpenid,
              dayKey: range.dayKey,
              count: used,
              updatedAt: Date.now(),
            };
            if (quota && quota._id) {
              await quotaRef.update({ data: quotaData });
            } else {
              await quotaRef.set({ data: Object.assign({ createdAt: Date.now() }, quotaData) });
            }
          }
          await tournamentRef.remove();
          return { deleted: true };
        });
        return result && result.error ? fail(result.error) : ok(true);
      } catch (e) {
        if (isTransactionConflict(e) && attempt < 5) continue;
        throw e;
      }
    }
    return ok(true);
  },

  /* 固定的内置队标列表：只读，不再由超管维护。 */
  async teamLogoList() {
    return ok({
      logos: TEAM_LOGO_PRESETS,
      presets: TEAM_LOGO_PRESETS,
      icons: TEAM_LOGO_IDS,
    });
  },

  /* 系统分组：预览分组结果（不落库）。每组 K 人；全局前 N 名分别担任组长；均分差尽量 ≤200 */
  async autoGroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const synced = await syncTournamentRegistrations(t);
    const players = synced.registrations.filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    const result = runAutoGroup(players, t.N, t.K);
    const profiles = synced.profiles;
    result.groups = result.groups.map((group) => {
      const members = group.members.map((member) => {
        const profile = profiles[member.openid];
        const cardPlayer = Object.assign({}, member);
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
          rolesText: Array.isArray(cardPlayer.roles) ? cardPlayer.roles.map((role) => role + '号位').join(' / ') : '',
          signature: cardPlayer.signature || '',
          cardStyle: normalizeCardStyle(profile && profile.cardStyle || cardPlayer.cardStyle),
        });
      });
      const captain = members.find((member) => member.openid === (group.captain && group.captain.openid)) || members[0] || null;
      members.forEach((member) => (member.isCaptain = !!captain && member.openid === captain.openid));
      return Object.assign({}, group, { captain, members });
    });
    return ok(result);
  },

  /* 系统分组：确认分组并写入队伍（服务端重算，不信任客户端数据） */
  async confirmGroup(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const current = managed.tournament;
    const latestProfiles = await syncTournamentRegistrations(current);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode !== 'auto') return { error: '本场比赛不是系统分组模式' };
      if (t.status !== 'registration') return { error: '当前不在报名阶段' };
      const synced = syncRegistrationProfiles(t.registrations, latestProfiles.profiles);
      const registrations = synced.registrations;
      const players = registrations.filter((r) => r.role === 'player');
      const need = t.N * t.K;
      if (players.length < need) return { error: '队员尚未报满（' + players.length + '/' + need + '），报满后才能分组' };
      const playerById = {};
      players.forEach((p) => (playerById[p.openid] = p));
      let groups;
      if (Array.isArray(event.groups)) {
        if (event.groups.length !== t.N) return { error: '分组数据不正确（组数不符）' };
        const seen = {};
        let total = 0;
        groups = event.groups.map((arr, gi) => {
          if (!Array.isArray(arr) || arr.length !== t.K || arr.length < 1) return { error: '第 ' + (gi + 1) + ' 组人数不正确（需恰好 ' + t.K + ' 人）' };
          return arr.map((oid) => {
            if (typeof oid !== 'string' || seen[oid] || !playerById[oid]) return { error: '分组数据不正确（重复或非报名队员）' };
            seen[oid] = true;
            total++;
            return playerById[oid];
          });
        });
        const invalid = groups.find((group) => group && group.error) ||
          groups.reduce((found, group) => found || (Array.isArray(group) && group.find((member) => member && member.error)), null);
        if (invalid) return invalid;
        if (total !== players.length) return { error: '还有队员未分组' };
        const captainCheck = validateAutoGroupCaptains(players, groups, t.N);
        if (captainCheck.error) return captainCheck;
        groups = groups.map((members) => members.slice().sort((a, b) => (b.mmr || 0) - (a.mmr || 0)));
      } else {
        groups = runAutoGroup(players, t.N, t.K).groups.map((g) => g.members);
      }
      const teams = groups.map((members) => {
        const captain = members[0];
        return {
          captain: {
            openid: captain.openid,
            nickname: captain.nickname,
            teamName: '',
            teamIcon: '',
            mmr: captain.mmr,
            ...registrationDotaFields(captain),
            roles: captain.roles || [],
            signature: captain.signature || '',
          },
          players: members.slice(1).map((m) => ({
            openid: m.openid,
            nickname: m.nickname,
            mmr: m.mmr,
            ...registrationDotaFields(m),
            roles: m.roles || [],
            signature: m.signature || '',
          })),
        };
      });
      return { data: { status: 'draft', registrations, teams, captainOrder: [], draft: null, seeding: null }, result: {} };
    });
    return result.error ? fail(result.error) : ok({});
  },

  /* 系统分组：在分组阶段保存比赛创建者或最高管理员调整后的队员名单。 */
  async saveAutoGroups(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto' || t.status !== 'draft') return fail('当前不在系统分组阶段');
    if ((t.matches || []).length) return fail('对阵已生成，不能再调整分组');
    const players = (t.registrations || []).filter((registration) => registration.role === 'player');
    const checked = validateAutoGroups(players, event.groups, t.N, t.K);
    if (checked.error) return fail(checked.error);

    const oldTeams = t.teams || [];
    const teams = checked.groups.map((members, index) => {
      const oldCaptain = oldTeams[index] && oldTeams[index].captain || {};
      const captain = members[0];
      return {
        captain: {
          openid: captain.openid,
          nickname: captain.nickname,
          teamName: oldCaptain.teamName || '',
          teamIcon: oldCaptain.teamIcon || '',
          mmr: captain.mmr,
          ...registrationDotaFields(captain),
          roles: captain.roles || [],
          signature: captain.signature || '',
        },
        players: members.slice(1).map((member) => ({
          openid: member.openid,
          nickname: member.nickname,
          mmr: member.mmr,
          ...registrationDotaFields(member),
          roles: member.roles || [],
          signature: member.signature || '',
        })),
      };
    });
    await updateTournamentDoc(t._id, { data: { teams, updatedAt: Date.now() } });
    return ok(true);
  },

  /* 系统分组：返回报名阶段重新分组（比赛创建者或最高管理员） */
  async resetGroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto') return fail('仅系统分组模式支持重新分组');
    if (t.status !== 'draft') return fail('只有分组完成后（未生成对阵前）可以重新分组');
    await updateTournamentDoc(t._id, {
      data: { status: 'registration', teams: [], seeding: null, matches: [], champion: null, updatedAt: Date.now() },
    });
    return ok(true);
  },

  /* 系统分组：一键重新分组（比赛创建者或最高管理员）。
     直接在分组阶段重算并替换当前分组（随机化：组长仍为天梯分前 N，组员入组顺序打乱），
     保留各队已设置的队名/队标；仅分组完成后（未生成对阵前）可调用。 */
  async regroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const current = managed.tournament;
    const latestProfiles = await syncTournamentRegistrations(current);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode !== 'auto') return { error: '仅系统分组模式支持重新分组' };
      if (t.status !== 'draft') return { error: '只有分组完成后（未生成对阵前）可以重新分组' };
      if ((t.matches || []).length) return { error: '对阵已生成，不能再重新分组' };
      const synced = syncRegistrationProfiles(t.registrations, latestProfiles.profiles);
      const players = synced.registrations.filter((r) => r.role === 'player');
      const need = t.N * t.K;
      if (players.length < need) return { error: '队员尚未报满（' + players.length + '/' + need + '），报满后才能分组' };
      const groups = runAutoGroup(players, t.N, t.K).groups.map((g) => g.members);
      const oldTeams = t.teams || [];
      const teams = groups.map((members, index) => {
        const oldCaptain = oldTeams[index] && oldTeams[index].captain || {};
        const captain = members[0];
        return {
          captain: {
            openid: captain.openid,
            nickname: captain.nickname,
            teamName: oldCaptain.teamName || '',
            teamIcon: oldCaptain.teamIcon || '',
            mmr: captain.mmr,
            ...registrationDotaFields(captain),
            roles: captain.roles || [],
            signature: captain.signature || '',
          },
          players: members.slice(1).map((member) => ({
            openid: member.openid,
            nickname: member.nickname,
            mmr: member.mmr,
            ...registrationDotaFields(member),
            roles: member.roles || [],
            signature: member.signature || '',
          })),
        };
      });
      return { data: { teams }, result: {} };
    });
    return result.error ? fail(result.error) : ok({});
  },

  /* 生成虚拟测试用户并报名（仅超管；用于自测完整流程） */
  async seedTest(event) {
    if (!(await isSuper(getOpenId()))) return fail('仅最高管理员可生成测试数据');
    let t = null;
    if (event.id) {
      t = await getTournamentById(event.id);
    } else {
      const name = String(event.name || '').trim();
      if (!name) return fail('请传入比赛 id 或比赛名称');
      const res = await db.collection('tournaments').where({ name }).limit(1).get();
      t = res.data && res.data.length ? res.data[0] : null;
    }
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段（测试数据只能在报名阶段注入）');

    const VCAPS = [
      { nickname: '天府一号', mmr: 8800, roles: [1], signature: '梦想是打TI' },
      { nickname: '剑气纵横', mmr: 8300, roles: [2], signature: '中单霸主' },
      { nickname: '顽皮虎', mmr: 7900, roles: [3], signature: '一号位大腿' },
      { nickname: '竹林听风', mmr: 7500, roles: [4], signature: '四号位游走' },
      { nickname: '清欢渡', mmr: 7100, roles: [5], signature: '五号位守护神' },
      { nickname: '星夜骑士', mmr: 6800, roles: [1, 3], signature: '手残党慎选' },
      { nickname: '雾都游侠', mmr: 6500, roles: [2, 5], signature: '主打一个陪伴' },
    ];
    const VNAMES = [
      '幽鬼之刃', '虚空假面', '蓝猫淘气', '白牛冲锋', '神谕者', '潮汐猎人', '影魔登场', '屠夫钩子',
      '赏金猎人', '冰女宝宝', '火女莉娜', '风行天下', '白虎月神', '猴子猴孙', '剑圣无敌', '矮人火枪',
      '双头食人', '沙王地刺', '巫妖亡语', '术士乱斗', '先知树语', '撼地神牛', '主宰无敌', '昆卡船长',
      '巨魔战将', '刚背兽王', '谜团黑洞', '宙斯雷霆', '美杜莎之眼', '幻影长矛', '敌法师之怒', '痛苦女王',
    ];
    const SIGS = ['稳住别浪', '认真打每一把', '求个大腿带', '菜鸡互啄', '一波推平', '五号位保人', '手残但努力', '主打一个快乐'];
    const ROLE_POOL = [1, 2, 3, 4, 5];
    const pickRoles = () => {
      const n = 1 + Math.floor(Math.random() * 3);
      const arr = ROLE_POOL.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, n).sort();
    };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // 系统分组模式：补足虚拟队员到报满（不生成队长），并补足替补（最多 5 个）；位置按 1-5 轮转
    if (t.mode === 'auto') {
      const need = t.N * t.K;
      const waitLimit = t.waitLimit || 0;
      const curPlayers = (t.registrations || []).filter((r) => r.role === 'player');
      const curWait = (t.registrations || []).filter((r) => r.role === 'waitlist');
      const mkName = (i) => VNAMES[i % VNAMES.length] + (i >= VNAMES.length ? '·' + (Math.floor(i / VNAMES.length) + 1) : '');
      const mkRoles = (base) => {
        const extra = pickRoles().filter((r) => r !== base);
        return [base].concat(extra.slice(0, 1)).sort();
      };
      const vplys = [];
      if (curPlayers.length < need) {
        const count = need - curPlayers.length;
        for (let i = 0; i < count; i++) {
          const base = (i % 5) + 1;
          vplys.push({
            openid: 'vgrp' + (i + 1),
            nickname: mkName(i),
            mmr: 4000 + Math.floor(Math.random() * 5000),
            roles: mkRoles(base),
            signature: pick(SIGS),
            role: 'player',
          });
        }
      }
      const vwaits = [];
      if (waitLimit > 0 && curWait.length < waitLimit) {
        const wc = Math.min(5, waitLimit - curWait.length);
        for (let i = 0; i < wc; i++) {
          const base = ((i + 17) % 5) + 1; // 与队员错开轮转
          vwaits.push({
            openid: 'vgwa' + (i + 1),
            nickname: mkName(need + i),
            mmr: 3500 + Math.floor(Math.random() * 4500),
            roles: mkRoles(base),
            signature: pick(SIGS),
            role: 'waitlist',
          });
        }
      }
      const all = vplys.concat(vwaits);
      if (!all.length) return fail('队员与替补均已满，无需注入虚拟用户');
      const existing = (t.registrations || []).map((r) => r.openid);
      const skip = new Set(existing);
      const toAdd = all.filter((u) => !skip.has(u.openid));
      if (!toAdd.length) return fail('虚拟用户已全部报名过了（如需重新注入，请先删除本场比赛再重建）');
      const dups = await Promise.all(toAdd.map((u) => getUser(u.openid)));
      const toCreate = toAdd.filter((u, i) => !dups[i]);
      const CHUNK = 8;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const batch = toCreate.slice(i, i + CHUNK);
        await Promise.all(
          batch.map((u) =>
            db
              .collection('users')
              .add({ data: { openid: u.openid, nickname: u.nickname, mmr: u.mmr, roles: u.roles, signature: u.signature } })
              .catch(() => null)
          )
        );
      }
      const commit = await mutateTournament(db, t._id, (current) => {
        if (current.status !== 'registration') return { error: '当前不在报名阶段（测试数据只能在报名阶段注入）' };
        if (current.mode !== 'auto') return { error: '比赛模式已变化，请刷新后重试' };
        const existingIds = new Set((current.registrations || []).map((registration) => registration.openid));
        const currentNeed = current.N * current.K;
        const currentWaitLimit = current.waitLimit || 0;
        let playerSlots = Math.max(0, currentNeed - (current.registrations || []).filter((registration) => registration.role === 'player').length);
        let waitSlots = Math.max(0, currentWaitLimit - (current.registrations || []).filter((registration) => registration.role === 'waitlist').length);
        const additions = toAdd.filter((user) => {
          if (existingIds.has(user.openid)) return false;
          if (user.role === 'player' && playerSlots > 0) {
            playerSlots -= 1;
            return true;
          }
          if (user.role === 'waitlist' && waitSlots > 0) {
            waitSlots -= 1;
            return true;
          }
          return false;
        });
        if (!additions.length) return { error: '当前比赛没有可注入的测试名额' };
        const regs = additions.map((u) => ({
          openid: u.openid,
          nickname: u.nickname,
          role: u.role,
          ts: Date.now(),
          mmr: u.mmr,
          roles: u.roles,
          signature: u.signature,
        }));
        const registrations = (current.registrations || []).concat(regs);
        return {
          data: { registrations },
          result: {
            added: regs.length,
            playerFilled: registrations.filter((r) => r.role === 'player').length,
            playerTotal: currentNeed,
            waitlistFilled: registrations.filter((r) => r.role === 'waitlist').length,
            waitLimit: currentWaitLimit,
            auto: true,
          },
        };
      });
      return commit.error ? fail(commit.error) : ok(commit.result);
    }

    const vcaps = VCAPS.map((c, i) => ({
      openid: 'vcap' + (i + 1),
      nickname: c.nickname,
      mmr: c.mmr,
      roles: c.roles,
      signature: c.signature,
    }));
    const vplys = VNAMES.map((n, i) => ({
      openid: 'vply' + (i + 1),
      nickname: n,
      mmr: 4000 + Math.floor(Math.random() * 5000),
      roles: pickRoles(),
      signature: pick(SIGS),
    }));
    const all = vcaps.concat(vplys);

    const existing = (t.registrations || []).map((r) => r.openid);
    const skip = new Set(existing);
    const toAdd = all.filter((u) => !skip.has(u.openid));
    if (!toAdd.length) return fail('虚拟用户已全部报名过了（如需重新注入，请先删除本场比赛再重建）');

    // 写入 users（仅超管可用，走显式 openid 字段）；并行去重查询 + 分批并行写入，避免超时
    const dups = await Promise.all(toAdd.map((u) => getUser(u.openid)));
    const toCreate = toAdd.filter((u, i) => !dups[i]);
    const CHUNK = 8;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const batch = toCreate.slice(i, i + CHUNK);
      await Promise.all(
        batch.map((u) =>
          db
            .collection('users')
            .add({ data: { openid: u.openid, nickname: u.nickname, mmr: u.mmr, roles: u.roles, signature: u.signature } })
            .catch(() => null)
        )
      );
    }
    const commit = await mutateTournament(db, t._id, (current) => {
      if (current.status !== 'registration') return { error: '当前不在报名阶段（测试数据只能在报名阶段注入）' };
      if (current.mode === 'auto') return { error: '比赛模式已变化，请刷新后重试' };
      const existingIds = new Set((current.registrations || []).map((registration) => registration.openid));
      let captainSlots = Math.max(0, current.N - (current.registrations || []).filter((registration) => registration.role === 'captain').length);
      let playerSlots = Math.max(0, current.N * current.K - (current.registrations || []).filter((registration) => registration.role === 'player').length);
      let waitSlots = Math.max(0, (current.waitLimit || 0) - (current.registrations || []).filter((registration) => registration.role === 'waitlist').length);
      const additions = toAdd.filter((user) => {
        if (existingIds.has(user.openid)) return false;
        const role = user.openid.indexOf('vcap') === 0 ? 'captain' : 'player';
        if (role === 'captain' && captainSlots > 0) {
          captainSlots -= 1;
          return true;
        }
        if (role === 'player' && playerSlots > 0) {
          playerSlots -= 1;
          return true;
        }
        if (role === 'waitlist' && waitSlots > 0) {
          waitSlots -= 1;
          return true;
        }
        return false;
      });
      if (!additions.length) return { error: '当前比赛没有可注入的测试名额' };
      const regs = additions.map((u) => {
        const registration = {
          openid: u.openid,
          nickname: u.nickname,
          role: u.openid.indexOf('vcap') === 0 ? 'captain' : 'player',
          ts: Date.now(),
          mmr: u.mmr,
          roles: u.roles,
          signature: u.signature,
        };
        if (registration.role === 'captain') {
          registration.teamName = '';
          registration.teamIcon = '';
        }
        return registration;
      });
      const registrations = (current.registrations || []).concat(regs);
      return {
        data: { registrations },
        result: {
          added: regs.length,
          captainFilled: registrations.filter((r) => r.role === 'captain').length,
          playerFilled: registrations.filter((r) => r.role === 'player').length,
        },
      };
    });
    return commit.error ? fail(commit.error) : ok(commit.result);
  },

  /* 读取赛后感言（公开内容；发布权限仍由 addComment 校验） */
  async listComments(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const comments = publicComments(t, openid);
    const admin = await canManageTournament(t, openid);
    return ok({
      comments,
      canComment: canPostComment(t, openid, admin),
      myComment: comments.find((comment) => comment.isMine) || null,
    });
  },

  /* 发表或更新赛后感言：参赛者和本场比赛管理者各可留一条，最多 100 字。 */
  async addComment(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const admin = await canManageTournament(t, openid);
    if (!canPostComment(t, openid, admin)) return fail('仅比赛结束后的参赛者或本场比赛管理者可以留言');

    if (typeof event.text !== 'string') return fail('内容格式无效');
    const text = event.text.trim();
    if (!text) return fail('内容不能为空');
    if (Array.from(text).length > MAX_COMMENT_LENGTH) return fail('内容最多 100 字');

    const me = await getUser(openid);
    const registration = (t.registrations || []).find((r) => r && r.openid === openid);
    const teamMember = (t.teams || []).reduce((found, team) => {
      if (found || !team) return found;
      const members = [team.captain].concat(team.players || []);
      const member = members.find((item) => item && typeof item === 'object' && item.openid === openid);
      return member || found;
    }, null);
    const nickname = String((me && me.nickname) || (registration && registration.nickname) || (teamMember && teamMember.nickname) || (admin ? '比赛管理者' : '参赛者'))
      .trim()
      .slice(0, 20) || '用户';
    let saveResult;
    try {
      // 事务读取最新数组，避免两次并发提交为同一用户创建重复留言，
      // 也避免同时发表不同用户的留言时互相覆盖。
      saveResult = await db.runTransaction(async (transaction) => {
        const ref = transaction.collection('tournaments').doc(t._id);
        const fresh = await ref.get();
        const latest = fresh && fresh.data;
        if (!latest) return { error: '比赛不存在' };
        if (!canPostComment(latest, openid, admin)) return { error: '仅比赛结束后的参赛者或本场比赛管理者可以留言' };
        const comments = Array.isArray(latest.comments) ? latest.comments.map((comment) => Object.assign({}, comment)) : [];
        const existingIndex = comments.findIndex((comment) => commentOwner(comment) === openid);
        const now = Date.now();
        if (existingIndex >= 0) {
          comments[existingIndex] = Object.assign({}, comments[existingIndex], {
            openid,
            nickname,
            text,
            updatedAt: now,
          });
        } else {
          if (comments.length >= MAX_COMMENTS) return { error: '留言数量已达上限' };
          comments.push({ openid, nickname, text, createdAt: now, updatedAt: now });
        }
        await ref.update({ data: { comments, updatedAt: now } });
        return { comments };
      });
    } catch (e) {
      console.error('save tournament comment failed:', e);
      return fail('感言保存失败，请稍后重试');
    }
    if (saveResult && saveResult.error) return fail(saveResult.error);
    const visible = publicComments({ comments: saveResult.comments }, openid);
    return ok({
      comments: visible,
      myComment: visible.find((comment) => comment.isMine) || null,
    });
  },

  /* 比赛变化轮询：只返回小型版本信息，不组装完整名册和名片。 */
  async tournamentVersion(event) {
    const version = await getTournamentVersion(event.id);
    if (!version) return fail('比赛不存在');
    return ok(version);
  },

  /* 报名页变化轮询：只读取报名名单与名额统计，不装配赛程、评论和卡片资料。 */
  async tournamentRegistrationSnapshot(event) {
    const snapshot = await getTournamentRegistrationSnapshot(event.id, getOpenId());
    if (!snapshot) return fail('比赛不存在');
    return ok(snapshot);
  },

  /* 报名页首屏数据：只返回赛事基础信息、报名名单和本场比赛管理权限。 */
  async registrationDetail(event) {
    const openid = getOpenId();
    const snapshot = await getTournamentRegistrationSnapshot(event.id, openid).then(decorateRegistrationSnapshot);
    if (!snapshot) return fail('比赛不存在');
    return ok(Object.assign({}, snapshot, {
      settlementReady: snapshot.status === 'finished' && !!snapshot.champion,
    }));
  },

  /* 比赛详情（按 id；不传 id 时取今天最新创建的一场） */
  async tournament(event) {
    const openid = getOpenId();
    let t = null;
    if (event.id) {
      t = await getTournamentById(event.id);
    } else {
      const todayStart = Number(event.todayStart) || 0;
      const res = await db
        .collection('tournaments')
        .where(todayStart ? { createdAt: _.gte(todayStart) } : {})
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      t = res.data && res.data.length ? res.data[0] : null;
    }
    if (!t) return fail('比赛不存在');
    return ok(await composeTournament(t, openid));
  },
};

/* ---------------- 入口 ---------------- */

exports.main = async (event) => {
  try {
    const action = event.action || event.type;
    const fn = actions[action];
    if (!fn) return fail('未知操作：' + action);
    return await fn(event);
  } catch (e) {
    console.error('dota2 cloud function error:', e);
    return fail('服务异常：' + (e && e.message ? e.message : '未知错误'));
  }
};
