function chinaDayKey(now) {
  const shifted = new Date((Number(now) || Date.now()) + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function chinaDayRange(now) {
  const dayKey = chinaDayKey(now);
  const start = Date.parse(dayKey + 'T00:00:00.000Z') - 8 * 60 * 60 * 1000;
  return { dayKey, start, end: start + 24 * 60 * 60 * 1000 };
}

function createQuotaId(openid, dayKey) {
  return 'create_quota_' + Buffer.from(String(openid || '')).toString('hex') + '_' + dayKey;
}

function effectiveDailyCount(quotaCount, existingTournamentCount) {
  return Math.max(Number(quotaCount) || 0, Number(existingTournamentCount) || 0);
}

const DAILY_CREATE_LIMIT = 20;

// 只有普通管理员和超级管理员可以创建比赛，每日上限统一为 20 场。
function createDailyLimit(isAdminFlag) {
  return isAdminFlag === true ? DAILY_CREATE_LIMIT : 0;
}

module.exports = {
  chinaDayKey,
  chinaDayRange,
  createQuotaId,
  effectiveDailyCount,
  DAILY_CREATE_LIMIT,
  createDailyLimit,
};
