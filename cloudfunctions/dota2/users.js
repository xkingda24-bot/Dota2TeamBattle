/**
 * 用户档案读取：单查 / 按 openid 批量查 / 名片样式批量查 / 报名档案同步。
 * 从原 index.js 拆出（纯搬移）。
 */
const { db, _ } = require('./db');
const { selectUserRecord, buildUserMap } = require('./user-records');
const { syncRegistrationProfiles } = require('./registration');
const { normalizeCardStyle } = require('./cards');

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

module.exports = {
  REGISTRATION_PROFILE_FIELDS,
  getUser,
  getUsersByOpenids,
  syncTournamentRegistrations,
  getCardStylesByOpenids,
};
