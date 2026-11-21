const DAY_MS = 24 * 60 * 60 * 1000;
const BAN_DURATIONS = {
  '2d': { label: '2天', ms: 2 * DAY_MS },
  '4d': { label: '4天', ms: 4 * DAY_MS },
  '1w': { label: '一周', ms: 7 * DAY_MS },
  '2w': { label: '二周', ms: 14 * DAY_MS },
  permanent: { label: '永久', ms: null },
};

function isBanActive(record, now) {
  if (!record || record.liftedAt) return false;
  if (record.permanent === true || record.duration === 'permanent') return true;
  const endAt = Number(record.endAt);
  return Number.isFinite(endAt) && endAt > (Number(now) || Date.now());
}

function durationText(duration) {
  const item = BAN_DURATIONS[duration];
  return item ? item.label : '';
}

function buildBanRecord(input) {
  const params = input || {};
  const target = params.target || {};
  const now = Number(params.now) || Date.now();
  const duration = String(params.duration || '');
  const reason = String(params.reason || '').trim();
  const config = BAN_DURATIONS[duration];
  if (!config) return { error: '请选择有效的禁赛时长' };
  if (!reason) return { error: '请填写禁赛原因' };
  if (reason.length > 100) return { error: '禁赛原因最多 100 个字' };

  const existing = params.existing || null;
  const adjustingActive = isBanActive(existing, now);
  const startAt = adjustingActive && Number(existing.startAt) ? Number(existing.startAt) : now;
  const record = {
    openid: target.openid,
    nickname: String(target.nickname || '') || '未设置昵称',
    dota2Id: String(target.dota2Id || ''),
    duration,
    permanent: duration === 'permanent',
    reason,
    startAt,
    endAt: config.ms === null ? null : startAt + config.ms,
    createdAt: adjustingActive ? Number(existing.createdAt) || startAt : now,
    createdBy: adjustingActive ? existing.createdBy || params.operatorOpenid : params.operatorOpenid,
    updatedAt: now,
    updatedBy: params.operatorOpenid,
    liftedAt: null,
    liftedBy: '',
  };
  return { record, adjusted: adjustingActive };
}

function publicBanView(record, user) {
  const profile = user || {};
  return {
    openid: record.openid,
    nickname: String(profile.nickname || record.nickname || '') || '未设置昵称',
    dota2Id: String(profile.dota2Id || record.dota2Id || ''),
    duration: record.duration,
    durationText: durationText(record.duration),
    permanent: record.permanent === true || record.duration === 'permanent',
    reason: String(record.reason || ''),
    startAt: Number(record.startAt) || 0,
    endAt: record.endAt === null ? null : Number(record.endAt) || 0,
  };
}

function formatBanEnd(endAt) {
  const value = Number(endAt);
  if (!Number.isFinite(value) || value <= 0) return '';
  // 云函数运行环境时区不固定，面向群内用户统一展示北京时间。
  const date = new Date(value + 8 * 60 * 60 * 1000).toISOString();
  return date.slice(0, 10) + ' ' + date.slice(11, 16);
}

function banNotice(record) {
  const reason = String(record && record.reason || '').trim();
  const suffix = reason ? '，原因：' + reason : '';
  if (record && (record.permanent === true || record.duration === 'permanent')) {
    return '你已被永久禁赛' + suffix;
  }
  return '你正在禁赛中，禁赛至 ' + formatBanEnd(record && record.endAt) + suffix;
}

function attachActiveBans(users, records, now) {
  const activeByOpenid = new Map();
  (records || []).forEach((record) => {
    if (!record || !record.openid || !isBanActive(record, now)) return;
    const previous = activeByOpenid.get(record.openid);
    if (!previous || Number(record.updatedAt) > Number(previous.updatedAt)) activeByOpenid.set(record.openid, record);
  });
  return (users || []).map((user) => Object.assign({}, user, {
    ban: activeByOpenid.has(user.openid) ? publicBanView(activeByOpenid.get(user.openid), user) : null,
  }));
}

async function listBlacklistRecords(db) {
  const records = [];
  let offset = 0;
  while (true) {
    const result = await db.collection('blacklist').orderBy('_id', 'asc').skip(offset).limit(100).get();
    const batch = result.data || [];
    records.push(...batch);
    offset += batch.length;
    if (batch.length < 100) break;
  }
  return records;
}

async function findBlacklistRecord(db, openid) {
  const result = await db.collection('blacklist').where({ openid }).limit(1).get();
  return result.data && result.data.length ? result.data[0] : null;
}

async function getActiveBlacklistRecord(db, openid, now) {
  const record = await findBlacklistRecord(db, openid);
  return isBanActive(record, now) ? record : null;
}

module.exports = {
  BAN_DURATIONS,
  isBanActive,
  durationText,
  buildBanRecord,
  publicBanView,
  formatBanEnd,
  banNotice,
  attachActiveBans,
  listBlacklistRecords,
  findBlacklistRecord,
  getActiveBlacklistRecord,
};
