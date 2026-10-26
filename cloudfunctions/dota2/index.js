/**
 * Dota2 群内比赛管理 - 云函数
 *
 * 所有业务逻辑都走这里（小程序端不直连数据库），
 * 身份取自微信 openid（wxContext.OPENID），天然免登录；
 * 管理员为"名单制"：环境变量指定的账号初始化超管（superAdmin）+ 超管可添加多个管理员（admins）。
 *
 * 集合：users / tournaments / config（首次调用自动创建）
 *  config 中存：{ key:'admins', superAdmin: openid, admins: [openid...] }
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const { buildBracket } = require('./bracket');
const { calculateStandings } = require('./standings');
const { validateAutoGroups, replaceAutoGroupMember } = require('./grouping');
const { canInitializeSuperAdmin } = require('./bootstrap');
const { dotaRankLabel, isRankVerified, publicDotaCardFields } = require('./card-profile');
const { selectUserRecord, buildUserMap } = require('./user-records');
const { ADMIN_USER_SORT_FIELDS, buildAdminUsers } = require('./admin-users');
const { buildTestRegistrationAdditions } = require('./test-registration');

const COLLECTIONS = ['users', 'tournaments', 'config'];
const BO_LIST = ['BO1', 'BO3', 'BO5'];
const MAX_N = 16;
const MAX_K = 5;
const DOTA_ID_RE = /^\d{5,12}$/;
const DOTA_CACHE_TTL = 5 * 60 * 1000;
const DOTA_CACHE_MAX = 500;
const DOTA_LOOKUP_LIMIT = 5;
const DOTA_LOOKUP_WINDOW = 60 * 1000;
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
// Bundled presets avoid upload/storage permissions and keep team marks available offline.
const TEAM_LOGO_CONFIG_KEY = 'teamLogos';
const TEAM_LOGO_PRESETS = [
  { id: 'swords', name: '双刃', src: '/images/team-logos/swords.png' },
  { id: 'emblem', name: '徽记', src: '/images/team-logos/emblem.png' },
  { id: 'dragon', name: '巨龙', src: '/images/team-logos/dragon.png' },
  { id: 'wolf', name: '战狼', src: '/images/team-logos/wolf.png' },
  { id: 'bat', name: '夜蝠', src: '/images/team-logos/bat.png' },
  { id: 'phoenix', name: '凤凰', src: '/images/team-logos/phoenix.png' },
  { id: 'skull', name: '骷髅', src: '/images/team-logos/skull.png' },
  { id: 'eagle', name: '雄鹰', src: '/images/team-logos/eagle.png' },
  { id: 'snake', name: '毒蛇', src: '/images/team-logos/snake.png' },
  { id: 'tiger', name: '猛虎', src: '/images/team-logos/tiger.png' },
  { id: 'bear', name: '巨熊', src: '/images/team-logos/bear.png' },
  { id: 'scorpion', name: '蝎子', src: '/images/team-logos/scorpion.png' },
  { id: 'lion', name: '雄狮', src: '/images/team-logos/lion.png' },
  { id: 'horse', name: '战马', src: '/images/team-logos/horse.png' },
  { id: 'wings', name: '羽翼', src: '/images/team-logos/wings.png' },
  { id: 'bolt', name: '闪电', src: '/images/team-logos/bolt.png' },
];
const TEAM_LOGO_IDS = TEAM_LOGO_PRESETS.map((item) => item.id);

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
      /* 已存在则忽略 */
    }
  }
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
  // 与批量队员档案读取使用相同的稳定选择规则，避免重复用户记录让“我的”
  // 和赛事名片取到不同版本的资料。
  const res = await db.collection('users').where({ _openid: openid }).limit(100).get();
  const owned = selectUserRecord(res.data);
  if (owned) return owned;
  const res2 = await db.collection('users').where({ openid }).limit(100).get();
  return selectUserRecord((res2.data || []).filter((record) =>
    !(record && typeof record._openid === 'string' && record._openid)
  ));
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

async function getTeamLogoState() {
  const res = await db.collection('config').where({ key: TEAM_LOGO_CONFIG_KEY }).limit(1).get();
  const record = res.data && res.data.length ? res.data[0] : null;
  const configured = record && Array.isArray(record.logoIds) ? record.logoIds : TEAM_LOGO_IDS;
  const seen = {};
  const logoIds = configured.filter((id) => {
    if (TEAM_LOGO_IDS.indexOf(id) < 0 || seen[id]) return false;
    seen[id] = true;
    return true;
  });
  // Recover to defaults if an old/partial config leaves no usable presets.
  return { record, logoIds: logoIds.length ? logoIds : TEAM_LOGO_IDS.slice() };
}

async function saveTeamLogoState(state, logoIds) {
  const data = { key: TEAM_LOGO_CONFIG_KEY, logoIds, updatedAt: Date.now() };
  if (state.record) {
    await db.collection('config').doc(state.record._id).update({ data });
  } else {
    await db.collection('config').add({ data });
  }
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
  // 冠军产生后，管理员可能尚未点击归档；此时也允许在结算页留下感言。
  if (!tournament || tournament.status !== 'finished' || !tournament.champion) return false;
  return !!adminFlag || isTournamentParticipant(tournament, openid);
}

/* 按 openid 批量读取用户档案；兼容旧记录只保存 _openid 的用户。 */
async function getUsersByOpenids(openids) {
  const ids = Array.from(new Set((openids || []).filter((id) => typeof id === 'string' && id)));
  if (!ids.length) return {};
  const chunks = [];
  for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
  const [explicitResults, ownerResults] = await Promise.all([
    Promise.all(chunks.map((chunk) => db.collection('users').where({ openid: _.in(chunk) }).limit(100).get().catch(() => ({ data: [] })))),
    Promise.all(chunks.map((chunk) => db.collection('users').where({ _openid: _.in(chunk) }).limit(100).get().catch(() => ({ data: [] })))),
  ]);
  const ownerRecords = ownerResults.reduce((all, result) => all.concat(result.data || []), []);
  const explicitRecords = explicitResults.reduce((all, result) => all.concat(result.data || []), []);
  return buildUserMap(ids, ownerRecords, explicitRecords);
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

async function getRecentTournamentSummaries(filter, limit, openid, archived) {
  const summaries = [];
  let offset = 0;
  while (summaries.length < limit) {
    const result = await db.collection('tournaments')
      .where(filter)
      .orderBy('createdAt', 'desc')
      .skip(offset)
      .limit(100)
      .get();
    const batch = result.data || [];
    const matching = batch.filter((tournament) => !tournament.deletedAt &&
      (archived == null || !!tournament.archivedAt === archived));
    summaries.push(...matching.map((tournament) => summarize(tournament, openid)));
    offset += batch.length;
    if (batch.length < 100) break;
  }
  return summaries.slice(0, limit);
}

/* ---------------- 管理员权限（名单制） ---------------- */

async function getAdminsConfig() {
  const res = await db.collection('config').where({ key: 'admins' }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  return { key: 'admins', superAdmin: '', admins: [] };
}

async function isAdmin(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin || (cfg.admins || []).indexOf(openid) >= 0;
}

async function isSuper(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin;
}

async function isAdminUser() {
  return isAdmin(getOpenId());
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
  const userProfiles = await getUsersByOpenids(profileOpenids);
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
  const admin = await isAdmin(myOpenid);
  const superFlag = await isSuper(myOpenid);

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
    secret: admin ? t.secret : '', // 暗号仅管理员可见
    myOpenid,
    isAdmin: admin,
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
    canComment: canPostComment(t, myOpenid, admin),
    myComment: comments.find((comment) => comment.isMine) || null,
    createdAt: t.createdAt,
    archivedAt: t.archivedAt || null,
  };
}

/* 比赛列表摘要 */
function summarize(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const caps = (t.registrations || []).filter((r) => r.role === 'captain').length;
  const players = (t.registrations || []).filter((r) => r.role === 'player').length;
  return {
    id: t._id,
    name: t.name,
    time: t.time,
    mode,
    N: t.N,
    K: t.K,
    status: t.status,
    captainFilled: caps,
    captainTotal: mode === 'auto' ? 0 : t.N,
    playerFilled: players,
    playerTotal: t.N * t.K,
    champion: t.champion || null,
    creatorName: t.creatorName || '',
    createdAt: t.createdAt,
    archivedAt: t.archivedAt || null,
    deletedAt: t.deletedAt || null,
    meRegistered: myOpenid ? (t.registrations || []).some((r) => r.openid === myOpenid) : false,
  };
}

/* ---------------- 动作 ---------------- */

/* 系统分组算法：
   1) 位置代表构建：每组依次从 1-5 号位各选一名会该位置的队员（优先均分均衡）
   2) 补位：每组补到 K 人，优先补该组缺失的位置
   3) 爬山优化：随机交换两人，组间均分差更小（且缺位不增加）则接受
   返回预览结构（含每组名单/均分/缺位） */
function runAutoGroup(players, N, K) {
  const has = (p, r) => Array.isArray(p.roles) && p.roles.indexOf(r) >= 0;
  const missingRoles = (g) => {
    const s = new Set();
    g.forEach((p) => (p.roles || []).forEach((r) => s.add(r)));
    const m = [];
    for (let r = 1; r <= 5; r++) if (!s.has(r)) m.push(r);
    return m;
  };
  const avg = (g) => (g.length ? g.reduce((s, p) => s + (p.mmr || 0), 0) / g.length : 0);

  let groups = [];
  for (let i = 0; i < N; i++) groups.push([]);
  const pool = players.map((p) => Object.assign({}, p));

  // 1. 位置代表：每组依次拿 1-5 号位人选（同位置候选里选 mmr 与当前组均值最接近的）
  for (let r = 1; r <= 5; r++) {
    for (let gi = 0; gi < N; gi++) {
      if (groups[gi].length >= K) continue;
      const cand = pool.filter((p) => has(p, r));
      if (!cand.length) continue; // 全局无人会该位置 → 该组缺位
      const curAvg = groups[gi].length ? avg(groups[gi]) : null;
      let pick = cand[0];
      let bestD = Infinity;
      cand.forEach((p) => {
        const d = curAvg == null ? 0 : Math.abs((p.mmr || 0) - curAvg);
        if (d < bestD) {
          bestD = d;
          pick = p;
        }
      });
      groups[gi].push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
  }

  // 2. 补位：每组补到 K 人，优先补该组缺失位置的人
  for (let gi = 0; gi < N; gi++) {
    while (groups[gi].length < K && pool.length) {
      const miss = missingRoles(groups[gi]);
      let pick = null;
      for (let r of miss) {
        const c = pool.filter((p) => has(p, r));
        if (c.length) {
          pick = c[0];
          break;
        }
      }
      if (!pick) pick = pool[0];
      groups[gi].push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
  }

  // 3. 爬山优化：随机交换，均分差变小（同分则缺位变少）才接受
  const score = () => {
    const av = groups.map(avg);
    const maxD = Math.max.apply(null, av) - Math.min.apply(null, av);
    const missN = groups.reduce((s, g) => s + missingRoles(g).length, 0);
    return { maxD, missN };
  };
  let bestS = score();
  let best = groups.map((g) => g.slice());
  for (let iter = 0; iter < 4000; iter++) {
    const gi = Math.floor(Math.random() * N);
    let gj = Math.floor(Math.random() * N);
    if (gj === gi) gj = (gj + 1) % N;
    const ai = Math.floor(Math.random() * groups[gi].length);
    const bj = Math.floor(Math.random() * groups[gj].length);
    const tmp = groups[gi][ai];
    groups[gi][ai] = groups[gj][bj];
    groups[gj][bj] = tmp;
    const s = score();
    // 缺位优先（位置覆盖不牺牲），缺位相同再优化组间均分差
    if (s.missN < bestS.missN || (s.missN === bestS.missN && s.maxD < bestS.maxD)) {
      bestS = s;
      best = groups.map((g) => g.slice());
    } else {
      const tmp2 = groups[gi][ai];
      groups[gi][ai] = groups[gj][bj];
      groups[gj][bj] = tmp2;
    }
  }
  groups = best;

  // 4. 组装输出
  const out = [];
  for (let gi = 0; gi < N; gi++) {
    const g = groups[gi].slice().sort((a, b) => (b.mmr || 0) - (a.mmr || 0));
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
  return { groups: out, maxDiff: Math.round(bestS.maxD), maxDiffOk: bestS.maxD <= 300 };
}

const actions = {
  /* 主页数据：今天的比赛 + 之前的比赛 + 我的身份 */
  async home(event) {
    const openid = getOpenId();
    const [user, cfg] = await Promise.all([getUser(openid), getAdminsConfig()]);
    const isAdminFlag = openid === cfg.superAdmin || (cfg.admins || []).indexOf(openid) >= 0;
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
    return ok({
      user,
      isAdmin: isAdminFlag,
      isSuper: isSuperFlag,
      hasSuper: !!cfg.superAdmin,
      // 已归档的比赛进入历史，已删除的比赛只在回收站显示。
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
    // 个人签名（选填，不超过 15 个字）
    const signature = String(event.signature || '').trim();
    if (signature.length > 15) return fail('个人签名最多 15 个字');

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
    const data = { superAdmin: openid, admins: [], createdAt: Date.now() };
    if (cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data });
    } else {
      await db.collection('config').add({ data: Object.assign({ key: 'admins' }, data) });
    }
    return ok({ isSuper: true });
  },

  /* 管理员信息（所有用户可看）；超管可管理用户 */
  async getStaff() {
    const openid = getOpenId();
    const cfg = await getAdminsConfig();
    const ids = [cfg.superAdmin].concat(cfg.admins || []).filter(Boolean);
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
      admins: members.filter((m) => m.openid !== cfg.superAdmin),
      isAdmin: await isAdmin(openid),
      isSuper: await isSuper(openid),
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

  /* 超管：添加管理员（按 openid 或昵称） */
  async addAdmin(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以添加管理员');
    let targetOpenid = String(event.openid || '').trim();
    let target = null;
    if (targetOpenid) {
      target = await getUser(targetOpenid);
      if (!target) return fail('未找到该用户');
    } else {
      const nickname = String(event.nickname || '').trim();
      if (!nickname) return fail('请输入要添加的用户昵称');
      const res = await db.collection('users').where({ nickname }).limit(1).get();
      if (!res.data || !res.data.length) return fail('没有找到昵称为「' + nickname + '」的用户（对方需先设置昵称）');
      target = res.data[0];
      targetOpenid = target.openid || target._openid || '';
    }
    if (!targetOpenid) return fail('无法识别该用户的身份，请让对方重新设置一次昵称');
    if (targetOpenid === openid) return fail('你已经是最高管理员');
    const cfg = await getAdminsConfig();
    if ((cfg.admins || []).indexOf(targetOpenid) >= 0) return fail('该用户已是管理员');
    const admins = (cfg.admins || []).concat([targetOpenid]);
    await db.collection('config').doc(cfg._id).update({ data: { admins } });
    return ok(true);
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
      const result = await db.collection('users').orderBy('_id', 'asc').skip(offset).limit(100).get();
      const batch = result.data || [];
      records.push(...batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }
    const sortedUsers = buildAdminUsers(records, cfg.admins || [], cfg.superAdmin, sortBy, order);
    const start = (page - 1) * pageSize;
    const users = sortedUsers.slice(start, start + pageSize);
    return ok({
      users,
      page,
      pageSize,
      total: sortedUsers.length,
      hasMore: start + users.length < sortedUsers.length,
      sortBy,
      order,
    });
  },

  /* 超管：移除管理员 */
  async removeAdmin(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以移除管理员');
    const targetOpenid = event.openid;
    if (targetOpenid === openid) return fail('不能移除自己（最高管理员）');
    const cfg = await getAdminsConfig();
    const admins = (cfg.admins || []).filter((id) => id !== targetOpenid);
    if (admins.length === (cfg.admins || []).length) return fail('该用户不是管理员');
    await db.collection('config').doc(cfg._id).update({ data: { admins } });
    return ok(true);
  },

  /* 超管：删除用户资料并撤销其管理员权限，赛事内嵌的历史快照保留。 */
  async deleteUser(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以删除用户账号');
    const targetOpenid = String(event.openid || '').trim();
    if (!targetOpenid) return fail('缺少要删除的用户');
    if (targetOpenid === openid) return fail('不能删除当前最高管理员账号');
    const cfg = await getAdminsConfig();
    if (targetOpenid === cfg.superAdmin) return fail('不能删除最高管理员账号');
    const target = await getUser(targetOpenid);
    if (!target) return fail('未找到该用户');

    const loadAllMatches = async (field) => {
      const result = [];
      let offset = 0;
      while (true) {
        const page = await db.collection('users').where({ [field]: targetOpenid }).orderBy('_id', 'asc').skip(offset).limit(100).get();
        const batch = page.data || [];
        result.push(...batch);
        offset += batch.length;
        if (batch.length < 100) break;
      }
      return result;
    };
    const [ownedRecords, explicitRecords] = await Promise.all([
      loadAllMatches('_openid'),
      loadAllMatches('openid'),
    ]);
    const uniqueRecords = new Map();
    ownedRecords.concat(explicitRecords.filter((record) =>
      !(record && typeof record._openid === 'string' && record._openid)
    )).forEach((record) => {
      if (record && record._id) uniqueRecords.set(record._id, record);
    });
    if (!uniqueRecords.size) return fail('未找到该用户的资料记录');

    const admins = (cfg.admins || []).filter((id) => id !== targetOpenid);
    if (admins.length !== (cfg.admins || []).length && cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data: { admins } });
    }
    for (const record of uniqueRecords.values()) {
      await db.collection('users').doc(record._id).remove();
    }
    return ok({ deleted: true, removedRecords: uniqueRecords.size });
  },

  /* 创建比赛（管理员）：支持多场并行，报名需暗号 */
  async createTournament(event) {
    if (!(await isAdminUser())) return fail('只有管理员可以创建比赛');
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
    const me = await getUser(openid);
    const res = await db.collection('tournaments').add({
      data: {
        name,
        time,
        secret,
        mode,
        N,
        K,
        waitLimit: Math.round(waitLimit),
        status: 'registration',
        registrations: [],
        captainOrder: [],
        draft: null,
        teams: [],
        seeding: null,
        matches: [],
        champion: null,
        comments: [],
        createdAt: Date.now(),
        createdBy: openid,
        creatorName: me ? me.nickname : '',
      },
    });
    return ok({ id: res._id });
  },

  /* 管理员：修改报名阶段的比赛配置（名称/时间/暗号/模式/队伍数/每队人数或队友数/替补数） */
  async updateConfig(event) {
    if (!(await isAdminUser())) return fail('只有管理员可以修改配置');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以修改配置');
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
    // 名额不能小于已报名人数
    const captains = (t.registrations || []).filter((r) => r.role === 'captain').length;
    const players = (t.registrations || []).filter((r) => r.role === 'player').length;
    const waitlist = (t.registrations || []).filter((r) => r.role === 'waitlist').length;
    // 系统分组模式无队长名额
    if (mode === 'auto') {
      if (captains > 0) return fail('已有队长报名，不能切换为系统分组模式（请先移除队长报名）');
      if (N * K < players) return fail('队员名额不能小于已报名人数（当前已报 ' + players + ' 人）');
    } else {
      if (N < captains) return fail('已有 ' + captains + ' 位队长报名，队长数不能小于 ' + captains);
      if (N * K < players) return fail('队员名额不能小于已报名人数（当前已报 ' + players + ' 人）');
    }
    if (waitLimit < waitlist) return fail('替补名额不能小于已报名替补人数（当前 ' + waitlist + ' 人）');
    await db.collection('tournaments').doc(t._id).update({
      data: { name, time, secret, mode, N, K, waitLimit: Math.round(waitLimit), updatedAt: Date.now() },
    });
    return ok({});
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
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以补充测试数据');

    const result = buildTestRegistrationAdditions(t, Date.now());
    if (!result.additions.length) {
      return ok({ added: 0, counts: result.counts, targets: result.targets });
    }
    const update = await db.collection('tournaments').where({ _id: t._id, status: 'registration' }).update({
      data: {
        registrations: (t.registrations || []).concat(result.additions),
        updatedAt: Date.now(),
      },
    });
    if (!update.stats || update.stats.updated !== 1) return fail('比赛阶段已变化，请刷新后重试');
    return ok({ added: result.additions.length, counts: result.counts, targets: result.targets });
  },

  /* 报名（需暗号）：队长/队员/替补；队员满时自动进入替补；资料（昵称/天梯分/常玩位置）必填才可报名 */
  async register(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me || !me.nickname) return fail('请先设置昵称');
    if (me.mmr == null) return fail('请先在「我的-编辑资料」填写天梯分后再报名');
    if (!Array.isArray(me.roles) || me.roles.length === 0) return fail('请先在「我的-编辑资料」选择常玩位置后再报名');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    if (String(event.secret || '') !== String(t.secret || '')) return fail('报名暗号错误');
    if ((t.registrations || []).some((r) => r.openid === openid)) return fail('你已经报名过了');
    const waitLimit = t.waitLimit || 0;
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const waitlist = (t.registrations || []).filter((r) => r.role === 'waitlist');
    let role = 'player';
    let auto = false;
    if (event.role === 'captain') {
      if (t.mode === 'auto') return fail('本场比赛为系统分组模式，请报名队员或替补');
      role = 'captain';
      if (captains.length >= t.N) return fail('队长名额已满');
    } else if (event.role === 'waitlist') {
      role = 'waitlist';
      if (waitLimit <= 0) return fail('本场比赛未设置替补');
      if (waitlist.length >= waitLimit) return fail('替补名额已满');
    } else {
      if (players.length >= t.N * t.K) {
        // 队员名额已满 → 自动加入替补
        if (waitLimit <= 0) return fail('队员名额已满');
        if (waitlist.length >= waitLimit) return fail('队员名额已满，替补也已满');
        role = 'waitlist';
        auto = true;
      }
    }
    const reg = {
      openid,
      nickname: me.nickname,
      role,
      ts: Date.now(),
      mmr: me.mmr || null,
      ...registrationDotaFields(me),
      roles: me.roles || [],
      signature: me.signature || '',
    };
    if (role === 'captain') {
      reg.teamName = '';
      reg.teamIcon = '';
    }
    const registrations = (t.registrations || []).concat([reg]);
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok({ role, auto });
  },

  /* 设置队伍名称（队长本人/组长本人或管理员；队长选人模式报名阶段，系统分组模式分组完成后；最多 10 个字） */
  async setTeamName(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const teamName = String(event.teamName || '').trim();
    if (teamName.length > 10) return fail('队伍名称最多 10 个字');
    const hasTeamIcon = Object.prototype.hasOwnProperty.call(event, 'teamIcon');
    const teamIcon = hasTeamIcon ? String(event.teamIcon || '').trim() : null;
    if (hasTeamIcon && teamIcon && TEAM_LOGO_IDS.indexOf(teamIcon) < 0) return fail('请选择队标库中的预设队标');
    const targetOpenid = String(event.openid || '') || openid;
    const isAdminFlag = await isAdmin(openid);
    if (targetOpenid !== openid && !isAdminFlag) return fail('只有队长本人或管理员可以设置队伍名称');

    // 系统分组模式：组长（本队天梯分最高者）在分组完成后命名
    if (t.mode === 'auto') {
      if (t.status !== 'draft' && t.status !== 'battle') return fail('只有分组完成后可以设置队伍名称');
      const teams = (t.teams || []).map((tm) => Object.assign({}, tm));
      const ti = teams.findIndex((tm) => tm.captain && tm.captain.openid === targetOpenid);
      if (ti < 0) return fail('只能由组长（本队天梯分最高者）或管理员设置队伍名称');
      if (hasTeamIcon && teamIcon) {
        const logoState = await getTeamLogoState();
        const existingIcon = teams[ti].captain.teamIcon || '';
        if (logoState.logoIds.indexOf(teamIcon) < 0 && teamIcon !== existingIcon) return fail('请选择当前可用的队标预设');
      }
      teams[ti] = Object.assign({}, teams[ti], {
        captain: Object.assign({}, teams[ti].captain, Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {})),
      });
      await db.collection('tournaments').doc(t._id).update({ data: { teams } });
      return ok(true);
    }

    // 队长选人模式（原逻辑）：报名阶段队长命名
    if (t.status !== 'registration') return fail('只有报名阶段可以设置队伍名称');
    const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
    const idx = registrations.findIndex((r) => r.openid === targetOpenid && r.role === 'captain');
    if (idx < 0) return fail('只能为已报名的队长设置队伍名称');
    if (hasTeamIcon && teamIcon) {
      const logoState = await getTeamLogoState();
      const existingIcon = registrations[idx].teamIcon || '';
      if (logoState.logoIds.indexOf(teamIcon) < 0 && teamIcon !== existingIcon) return fail('请选择当前可用的队标预设');
    }
    registrations[idx] = Object.assign({}, registrations[idx], Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {}));
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 管理员：报名阶段把队员移入替补 / 替补移回队员 */
  async moveRegistration(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以调整名单');
    const toRole = event.toRole === 'player' ? 'player' : 'waitlist';
    const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
    const idx = registrations.findIndex((r) => r.openid === event.openid);
    if (idx < 0) return fail('未找到该报名');
    const cur = registrations[idx];
    if (cur.role !== 'player' && cur.role !== 'waitlist') return fail('只能调整队员/替补');
    if (cur.role === toRole) return fail('该用户已在目标名单中');
    if (toRole === 'player') {
      const players = registrations.filter((r) => r.role === 'player').length;
      if (players >= t.N * t.K) return fail('队员名额已满，无法移入');
    } else {
      const waitLimit = t.waitLimit || 0;
      if (waitLimit <= 0) return fail('本场比赛未设置替补');
      const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
      if (waitlist >= waitLimit) return fail('替补名额已满');
    }
    registrations[idx] = Object.assign({}, cur, { role: toRole });
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 退报（报名阶段自己取消） */
  async cancelRegister(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('报名已锁定，请联系管理员');
    const registrations = (t.registrations || []).filter((r) => r.openid !== openid);
    if (registrations.length === (t.registrations || []).length) return fail('你尚未报名');
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 移除报名（管理员） */
  async removeRegistration(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const registrations = (t.registrations || []).filter((r) => r.openid !== event.openid);
    if (registrations.length === (t.registrations || []).length) return fail('未找到该报名');
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 开始选人（管理员）：随机排序队长，初始化蛇形轮次 */
  async startDraft(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    if (captains.length < t.N) return fail('队长尚未报满（' + captains.length + '/' + t.N + '）');
    if (players.length < t.N * t.K) {
      return fail('队员尚未报满（' + players.length + '/' + t.N * t.K + '）');
    }
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
    await db.collection('tournaments').doc(t._id).update({
      data: {
        status: 'draft',
        captainOrder,
        draft: { turn: 0, picks: captainOrder.map(() => []) },
      },
    });
    return ok(true);
  },

  /* 队长选人 / 管理员代选 */
  async pickPlayer(event) {
    const openid = getOpenId();
    const isAdminFlag = await isAdmin(openid);
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    if (openid !== currentCaptain.openid && !isAdminFlag) {
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
        },
      });
    if (!upd.stats || upd.stats.updated !== 1) {
      return fail('选人顺序有冲突，请刷新后再试');
    }
    const done = turn + 1 >= totalPicks;
    return ok({ picked: playerOpenid, teamIndex: capIdx, done });
  },

  /* 重置选人（管理员）：重新随机队长顺序并清空已选 */
  async resetDraft(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({
      data: {
        captainOrder,
        draft: { turn: 0, picks: captainOrder.map(() => []) },
      },
    });
    return ok(true);
  },

  /* 调整胜者组第一轮对阵（管理员，选人/分组完成后、生成对阵前） */
  async setSeeding(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({ data: { seeding } });
    return ok(true);
  },

  /* 随机对阵 */
  async shuffleSeeding(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    const base = [];
    for (let i = 0; i < t.N; i++) base.push(i);
    await db.collection('tournaments').doc(t._id).update({ data: { seeding: shuffle(base) } });
    return ok(true);
  },

  /* 生成对阵、进入对战阶段（管理员） */
  async startBracket(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({
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

  /* 配置比赛赛制（管理员） */
  async setMatchBo(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const bo = BO_LIST.indexOf(event.bo) >= 0 ? event.bo : null;
    if (!bo) return fail('赛制只能是 BO1 / BO3 / BO5');
    const idx = (t.matches || []).findIndex((m) => m.id === Number(event.matchId));
    if (idx < 0) return fail('比赛不存在');
    if (t.matches[idx].status === 'done') return fail('比赛已结束，不能修改赛制');
    const matches = (t.matches || []).slice();
    matches[idx] = Object.assign({}, matches[idx], { bo });
    await db.collection('tournaments').doc(t._id).update({ data: { matches } });
    return ok(true);
  },

  /* 记录比赛结果（管理员）：自动晋级 / 淘汰 / 产生冠军 */
  async setMatchResult(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({
      data: {
        matches,
        champion: _.set(champion),
        status,
        // 决赛打完标记已结束，但**不自动归档**：由管理员在主页/对战页手动归档
        archivedAt: t.archivedAt || null,
      },
    });
    return ok({ champion: champion ? champion.name : null, finished: status === 'finished' });
  },

  /* 修正比赛结果（管理员）：级联重置受影响的后续比赛 */
  async resetMatchResult(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({
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

  /* 管理员退回比赛阶段；只清除当前阶段之后的数据。 */
  async rollbackStage(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({ data });
    return ok({ status: target });
  },

  /* 管理员在选人或对战阶段替换队员；已记录任何赛果后锁定名单。 */
  async replacePlayer(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'draft' && t.status !== 'battle') return fail('仅选人/分组或对战阶段可以替换队员');
    if ((t.matches || []).some((match) => match.status === 'done')) return fail('已有比赛记录比分，不能再替换队员');
    const teamIndex = Number(event.teamIndex);
    const outOpenid = String(event.outOpenid || '').trim();
    const inOpenid = String(event.inOpenid || '').trim();
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || !outOpenid || !inOpenid || outOpenid === inOpenid) {
      return fail('替换队员参数无效');
    }

    const captainDraft = t.status === 'draft' && t.mode !== 'auto';
    if (captainDraft) {
      const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
      if (teamIndex >= picks.length) return fail('队伍索引无效');
      const outIndex = picks[teamIndex].indexOf(outOpenid);
      if (outIndex < 0) return fail('该队员不在此队伍');
      if (picks.some((team) => team.indexOf(inOpenid) >= 0)) return fail('该队员已被其他队伍选中');
      const registrations = t.registrations || [];
      if (!registrations.some((registration) => registration.openid === inOpenid && registration.role === 'player')) {
        return fail('换入队员不在未选队员池');
      }
      picks[teamIndex][outIndex] = inOpenid;
      await db.collection('tournaments').doc(t._id).update({
        data: { draft: Object.assign({}, t.draft, { picks }), updatedAt: Date.now() },
      });
      return ok({ outOpenid, inOpenid });
    }

    const teams = (t.teams || []).map((team) => Object.assign({}, team, { players: (team.players || []).slice() }));
    if (teamIndex >= teams.length) return fail('队伍索引无效');
    const team = teams[teamIndex];
    const captain = team.captain;
    const captainOpenid = typeof captain === 'string' ? captain : captain && captain.openid;
    const memberOpenid = (member) => typeof member === 'string' ? member : member && member.openid;
    const registrations = (t.registrations || []).map((registration) => Object.assign({}, registration));
    const outRegistration = registrations.find((registration) => registration.openid === outOpenid && registration.role === 'player');
    const inRegistration = registrations.find((registration) => registration.openid === inOpenid && registration.role === 'waitlist');
    if (!outRegistration) return fail('换下队员资料已失效');
    if (!inRegistration) return fail('换入用户不在替补池');

    if (t.mode === 'auto') {
      const result = replaceAutoGroupMember(team, registrations, outOpenid, inOpenid, {
        openid: inRegistration.openid,
        nickname: inRegistration.nickname,
        mmr: inRegistration.mmr,
        ...registrationDotaFields(inRegistration),
        roles: inRegistration.roles || [],
        signature: inRegistration.signature || '',
      });
      if (result.error) return fail(result.error);
      teams[teamIndex] = result.team;
      await db.collection('tournaments').doc(t._id).update({ data: { teams, registrations: result.registrations, updatedAt: Date.now() } });
      return ok({ outOpenid, inOpenid, outNickname: result.outNickname, inNickname: result.inNickname, captainOpenid: result.captainOpenid });
    }

    if (captainOpenid === outOpenid) return fail('队长不能被替换');
    const outIndex = team.players.findIndex((member) => memberOpenid(member) === outOpenid);
    if (outIndex < 0) return fail('该队员不在此队伍');

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
    await db.collection('tournaments').doc(t._id).update({ data: { teams, registrations, updatedAt: Date.now() } });
    return ok({ outOpenid, inOpenid, outNickname, inNickname: inRegistration.nickname });
  },

  /* 结束并归档（管理员）：手动把已结束的比赛归档到历史（要求已有冠军，未结束不能归档） */
  async finishTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.archivedAt) return fail('比赛已归档');
    if (!t.champion) return fail('比赛还未结束（未产生冠军），不能归档');
    await db.collection('tournaments').doc(t._id).update({
      data: { status: 'finished', archivedAt: Date.now() },
    });
    return ok(true);
  },

  /* 管理员微调结算名次；传空数组恢复为赛果自动排序。 */
  async setStandingsOrder(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({ data: { standingsOrder: order, updatedAt: Date.now() } });
    return ok({ standingsOrder: order });
  },

  /* 删除比赛（管理员）：移入回收站，保留比赛数据供恢复。 */
  async deleteTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id, true);
    if (!t) return fail('比赛不存在');
    if (t.deletedAt) return fail('比赛已在回收站中');
    await db.collection('tournaments').doc(t._id).update({ data: { deletedAt: Date.now(), updatedAt: Date.now() } });
    return ok(true);
  },

  /* 回收站：所有用户可查看最近删除的 10 场比赛。 */
  async listTrash() {
    const openid = getOpenId();
    const result = await db.collection('tournaments')
      .where({ deletedAt: _.gt(0) })
      .orderBy('deletedAt', 'desc')
      .limit(10)
      .get();
    return ok({ trash: (result.data || []).map((t) => Object.assign(summarize(t, openid), { deletedAt: t.deletedAt })) });
  },

  /* 管理员恢复回收站中的比赛。 */
  async restoreTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id, true);
    if (!t) return fail('比赛不存在');
    if (!t.deletedAt) return fail('比赛不在回收站中');
    await db.collection('tournaments').doc(t._id).update({ data: { deletedAt: null, updatedAt: Date.now() } });
    return ok(true);
  },

  /* 管理员彻底删除回收站中的比赛。 */
  async purgeTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id, true);
    if (!t) return fail('比赛不存在');
    if (!t.deletedAt) return fail('请先把比赛移入回收站');
    await db.collection('tournaments').doc(t._id).remove();
    return ok(true);
  },

  /* 队标库：内置 Dota 风格预设，无需云存储；所有用户可读取。 */
  async teamLogoList() {
    const state = await getTeamLogoState();
    const logos = state.logoIds
      .map((id) => TEAM_LOGO_PRESETS.find((item) => item.id === id))
      .filter(Boolean)
      .map((item, index) => Object.assign({}, item, { order: index }));
    const enabled = {};
    state.logoIds.forEach((id) => (enabled[id] = true));
    const openid = getOpenId();
    return ok({
      logos,
      presets: TEAM_LOGO_PRESETS.map((item) => Object.assign({}, item, { enabled: !!enabled[item.id] })),
      // 保留 icons 字段便于旧页面按字符串读取；新的页面使用 logos 的 id/name/src。
      icons: logos.map((item) => item.id),
      isSuper: await isSuper(openid),
    });
  },

  /* 超管保存队标库顺序（传完整 id 列表）；仅允许内置预设，避免任意外链图片。 */
  async teamLogoSave(event) {
    if (!(await isSuper(getOpenId()))) return fail('仅最高管理员可管理队标库');
    const state = await getTeamLogoState();
    const restoreId = String(event.logoId || '').trim();
    let ids;
    if (restoreId) {
      if (TEAM_LOGO_IDS.indexOf(restoreId) < 0) return fail('队标不存在');
      if (state.logoIds.indexOf(restoreId) >= 0) return fail('该队标已在队标库中');
      ids = state.logoIds.concat([restoreId]);
    } else {
      ids = Array.isArray(event.logoIds) ? event.logoIds.map((id) => String(id || '')) : [];
      if (!ids.length) return fail('至少保留一个队标');
      const seen = {};
      for (const id of ids) {
        if (TEAM_LOGO_IDS.indexOf(id) < 0 || seen[id]) return fail('队标列表包含未知或重复项目');
        seen[id] = true;
      }
      // 此分支只负责保存顺序；增删必须走对应的单项接口。
      const currentSet = {};
      state.logoIds.forEach((id) => (currentSet[id] = true));
      if (ids.length !== state.logoIds.length || ids.some((id) => !currentSet[id])) {
        return fail('队标列表已变化，请刷新后重试');
      }
    }
    await saveTeamLogoState(state, ids);
    return ok({ logos: ids.map((id) => TEAM_LOGO_PRESETS.find((item) => item.id === id)).filter(Boolean) });
  },

  /* 队标库删除：软删除内置预设，保留比赛历史中的既有 id。 */
  async teamLogoDelete(event) {
    if (!(await isSuper(getOpenId()))) return fail('仅最高管理员可管理队标库');
    const id = String(event.id || event.logoId || '').trim();
    if (!id || TEAM_LOGO_IDS.indexOf(id) < 0) return fail('队标不存在');
    const state = await getTeamLogoState();
    if (state.logoIds.indexOf(id) < 0) return fail('该队标已移除');
    if (state.logoIds.length <= 1) return fail('至少保留一个队标');
    const ids = state.logoIds.filter((value) => value !== id);
    await saveTeamLogoState(state, ids);
    return ok({ removed: id, logos: ids.map((value) => TEAM_LOGO_PRESETS.find((item) => item.id === value)).filter(Boolean) });
  },

  /* 调整队标顺序：与 teamLogoSave 分开命名，便于客户端按 Web 版语义调用。 */
  async teamLogoReorder(event) {
    if (!(await isSuper(getOpenId()))) return fail('仅最高管理员可管理队标库');
    const ids = Array.isArray(event.logoIds) ? event.logoIds.map((id) => String(id || '')) : [];
    const state = await getTeamLogoState();
    const expected = state.logoIds.slice().sort();
    const received = ids.slice().sort();
    if (received.length !== expected.length || received.some((id, index) => id !== expected[index])) {
      return fail('队标列表已变化，请刷新后重试');
    }
    return actions.teamLogoSave(event);
  },

  /* 系统分组：预览分组结果（不落库）。约束：每组 K 人；尽量覆盖 1-5 号位；组间均分差尽量 ≤300 */
  async autoGroup(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    const result = runAutoGroup(players, t.N, t.K);
    const profiles = await getUsersByOpenids(players.map((player) => player.openid));
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
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    // 支持管理员在预览中手动微调：传入最终分组（每组 openid 列表），服务端校验合法性后写入
    const playerById = {};
    players.forEach((p) => (playerById[p.openid] = p));
    let groups;
    if (Array.isArray(event.groups)) {
      if (event.groups.length !== t.N) return fail('分组数据不正确（组数不符）');
      const seen = {};
      let total = 0;
      groups = event.groups.map((arr, gi) => {
        if (!Array.isArray(arr) || arr.length !== t.K || arr.length < 1) return fail('第 ' + (gi + 1) + ' 组人数不正确（需恰好 ' + t.K + ' 人）');
        return arr.map((oid) => {
          if (typeof oid !== 'string' || seen[oid] || !playerById[oid]) return fail('分组数据不正确（重复或非报名队员）');
          seen[oid] = true;
          total++;
          return playerById[oid];
        });
      });
      if (total !== players.length) return fail('还有队员未分组');
      // 组长 = 组内天梯分最高者（排序仅用于稳定展示）
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
        players: members
          .slice(1)
          .map((m) => ({
            openid: m.openid,
            nickname: m.nickname,
            mmr: m.mmr,
            ...registrationDotaFields(m),
            roles: m.roles || [],
            signature: m.signature || '',
          })),
      };
    });
    await db.collection('tournaments').doc(t._id).update({
      data: { status: 'draft', teams, captainOrder: [], draft: null, seeding: null, updatedAt: Date.now() },
    });
    return ok({});
  },

  /* 系统分组：在分组阶段保存管理员调整后的队员名单。 */
  async saveAutoGroups(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({ data: { teams, updatedAt: Date.now() } });
    return ok(true);
  },

  /* 系统分组：返回报名阶段重新分组（管理员，未生成对阵前；报名名单保留） */
  async resetGroup(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.mode !== 'auto') return fail('仅系统分组模式支持重新分组');
    if (t.status !== 'draft') return fail('只有分组完成后（未生成对阵前）可以重新分组');
    await db.collection('tournaments').doc(t._id).update({
      data: { status: 'registration', teams: [], seeding: null, matches: [], champion: null, updatedAt: Date.now() },
    });
    return ok(true);
  },

  /* 生成虚拟测试用户并报名（管理员；用于自测完整流程） */
  async seedTest(event) {
    if (!(await isAdminUser())) return fail('仅管理员可生成测试数据');
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
      const regs = toAdd.map((u) => ({
        openid: u.openid,
        nickname: u.nickname,
        role: u.role,
        ts: Date.now(),
        mmr: u.mmr,
        roles: u.roles,
        signature: u.signature,
      }));
      const registrations = (t.registrations || []).concat(regs);
      await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
      return ok({
        added: regs.length,
        playerFilled: registrations.filter((r) => r.role === 'player').length,
        playerTotal: need,
        waitlistFilled: registrations.filter((r) => r.role === 'waitlist').length,
        waitLimit,
        auto: true,
      });
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
    const regs = toAdd.map((u) => {
      const r = {
        openid: u.openid,
        nickname: u.nickname,
        role: u.openid.indexOf('vcap') === 0 ? 'captain' : 'player',
        ts: Date.now(),
        mmr: u.mmr,
        roles: u.roles,
        signature: u.signature,
      };
      if (r.role === 'captain') {
        r.teamName = '';
        r.teamIcon = '';
      }
      return r;
    });
    const registrations = (t.registrations || []).concat(regs);
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok({ added: regs.length, captainFilled: registrations.filter((r) => r.role === 'captain').length, playerFilled: registrations.filter((r) => r.role === 'player').length });
  },

  /* 读取赛后感言（公开内容；发布权限仍由 addComment 校验） */
  async listComments(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const comments = publicComments(t, openid);
    const admin = await isAdmin(openid);
    return ok({
      comments,
      canComment: canPostComment(t, openid, admin),
      myComment: comments.find((comment) => comment.isMine) || null,
    });
  },

  /* 发表或更新赛后感言：参赛者和管理员各可留一条，最多 100 字。 */
  async addComment(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const admin = await isAdmin(openid);
    if (!canPostComment(t, openid, admin)) return fail('仅比赛结束后的参赛者或管理员可以留言');

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
    const nickname = String((me && me.nickname) || (registration && registration.nickname) || (teamMember && teamMember.nickname) || (admin ? '管理员' : '参赛者'))
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
        if (!canPostComment(latest, openid, admin)) return { error: '仅比赛结束后的参赛者或管理员可以留言' };
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
    await ensureCollections();
    const action = event.action || event.type;
    const fn = actions[action];
    if (!fn) return fail('未知操作：' + action);
    return await fn(event);
  } catch (e) {
    console.error('dota2 cloud function error:', e);
    return fail('服务异常：' + (e && e.message ? e.message : '未知错误'));
  }
};
