const { buildUserMap } = require('./user-records');
const { publicDotaCardFields } = require('./card-profile');

const ADMIN_USER_SORT_FIELDS = ['dota2Id', 'mmr', 'nickname', 'dota2RankTier'];

function compareIds(left, right) {
  const a = String(left);
  const b = String(right);
  return a.length - b.length || a.localeCompare(b);
}

function compareValues(a, b, sortBy) {
  if (sortBy === 'dota2Id') return compareIds(a, b);
  if (sortBy === 'mmr' || sortBy === 'dota2RankTier') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function sortAdminUsers(users, sortBy, order) {
  const field = ADMIN_USER_SORT_FIELDS.indexOf(sortBy) >= 0 ? sortBy : 'nickname';
  const direction = order === 'desc' ? -1 : 1;
  return (users || []).slice().sort((a, b) => {
    const left = a[field];
    const right = b[field];
    const leftEmpty = left === null || left === undefined || String(left).trim() === '';
    const rightEmpty = right === null || right === undefined || String(right).trim() === '';
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    if (!leftEmpty) {
      const compared = compareValues(left, right, field);
      if (compared) return compared * direction;
    }
    return String(a.nickname || '').localeCompare(String(b.nickname || '')) ||
      String(a.openid || '').localeCompare(String(b.openid || ''));
  });
}

function buildAdminUsers(records, adminOpenids, superAdminOpenid, sortBy, order, now) {
  const source = (records || []).filter(Boolean);
  const openids = Array.from(new Set(source.reduce((ids, record) => {
    const id = typeof record._openid === 'string' && record._openid ? record._openid : record.openid;
    if (typeof id === 'string' && id) ids.push(id);
    return ids;
  }, [])));
  const ownerRecords = source.filter((record) => typeof record._openid === 'string');
  const explicitRecords = source.filter((record) => typeof record.openid === 'string');
  const userMap = buildUserMap(openids, ownerRecords, explicitRecords);
  const adminSet = new Set((adminOpenids || []).filter(Boolean));
  const users = Object.keys(userMap).map((openid) => {
    const user = userMap[openid];
    const card = publicDotaCardFields(user.mmr, user, null, now);
    const rankTier = card.dota2RankVerified ? card.dota2RankTier : null;
    const mmrValue = user.mmr === null || user.mmr === undefined || user.mmr === '' ? null : Number(user.mmr);
    return {
      openid,
      nickname: String(user.nickname || ''),
      dota2Id: String(user.dota2Id || ''),
      mmr: Number.isFinite(mmrValue) ? mmrValue : null,
      dota2RankVerified: card.dota2RankVerified,
      dota2RankTier: rankTier,
      dota2RankLabel: card.dota2RankVerified ? card.dota2RankLabel : '未校验段位',
      dota2LeaderboardRank: card.dota2LeaderboardRank,
      dota2RankVerifiedAt: card.dota2RankVerifiedAt,
      isAdmin: adminSet.has(openid),
      isSuper: openid === superAdminOpenid,
    };
  });
  return sortAdminUsers(users, sortBy, order);
}

module.exports = { ADMIN_USER_SORT_FIELDS, sortAdminUsers, buildAdminUsers };
