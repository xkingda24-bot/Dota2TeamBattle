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

function normalizeAdminUserKeyword(keyword) {
  return String(keyword || '').trim().slice(0, 30).toLowerCase();
}

function filterAdminUsers(users, keyword) {
  const source = Array.isArray(users) ? users : [];
  const normalized = normalizeAdminUserKeyword(keyword);
  if (!normalized) return source.slice();
  return source.filter((user) => {
    const nickname = String(user && user.nickname || '').toLowerCase();
    const dota2Id = String(user && user.dota2Id || '').toLowerCase();
    return nickname.indexOf(normalized) >= 0 || dota2Id.indexOf(normalized) >= 0;
  });
}

function buildAdminUsers(records, superAdminOpenid, sortBy, order, now) {
  const source = (records || []).filter(Boolean);
  const openids = Array.from(new Set(source.reduce((ids, record) => {
    const id = typeof record._openid === 'string' && record._openid ? record._openid : record.openid;
    if (typeof id === 'string' && id) ids.push(id);
    return ids;
  }, [])));
  const ownerRecords = source.filter((record) => typeof record._openid === 'string');
  const explicitRecords = source.filter((record) => typeof record.openid === 'string');
  const userMap = buildUserMap(openids, ownerRecords, explicitRecords);
  const users = Object.keys(userMap).map((openid) => {
    const user = userMap[openid];
    const card = publicDotaCardFields(user.mmr, user, null, now);
    const rankTier = card.dota2RankVerified ? card.dota2RankTier : null;
    const mmrValue = user.mmr === null || user.mmr === undefined || user.mmr === '' ? null : Number(user.mmr);
    return {
      openid,
      nickname: String(user.nickname || ''),
      canCreateTournament: user.canCreateTournament === true,
      dota2Id: String(user.dota2Id || ''),
      mmr: Number.isFinite(mmrValue) ? mmrValue : null,
      dota2RankVerified: card.dota2RankVerified,
      dota2RankTier: rankTier,
      dota2RankLabel: card.dota2RankVerified ? card.dota2RankLabel : '未校验段位',
      dota2LeaderboardRank: card.dota2LeaderboardRank,
      dota2RankVerifiedAt: card.dota2RankVerifiedAt,
      isSuper: openid === superAdminOpenid,
    };
  });
  return sortAdminUsers(users, sortBy, order);
}

/**
 * 把「普通管理员 openid 列表」翻译成带昵称的名册，供超管在弹窗顶部一眼看清管理员是谁。
 * 昵称取自已经读进内存的全量用户列表，不额外查库；查不到人时标成「未设置昵称」。
 */
function buildAdminRoster(adminOpenids, users, superAdminOpenid) {
  const source = Array.isArray(adminOpenids) ? adminOpenids : [];
  const byOpenid = new Map((users || []).map((user) => [String(user && user.openid || ''), user]));
  const seen = new Set();
  const roster = [];
  source.forEach((value) => {
    const openid = String(value || '').trim();
    if (!openid || seen.has(openid)) return;
    seen.add(openid);
    const user = byOpenid.get(openid);
    roster.push({
      openid,
      nickname: String(user && user.nickname || '') || '未设置昵称',
      isSuper: !!superAdminOpenid && openid === String(superAdminOpenid),
    });
  });
  return roster;
}

module.exports = {
  ADMIN_USER_SORT_FIELDS,
  sortAdminUsers,
  normalizeAdminUserKeyword,
  filterAdminUsers,
  buildAdminUsers,
  buildAdminRoster,
};
