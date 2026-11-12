/**
 * 首页与历史列表动作。从原 index.js 拆出（纯搬移）。
 */
const { _ } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { getUser } = require('../users');
const { getAdminsConfig } = require('../permissions');
const { getRecentTournamentSummaries, getTodayCreateStats } = require('../tournaments');

module.exports = {
  /* 主页数据：今天的比赛 + 我的身份（历史赛事走 listHistory，收起状态下不再预取） */
  async home(event) {
    const openid = getOpenId();
    const [user, cfg] = await Promise.all([getUser(openid), getAdminsConfig()]);
    const isSuperFlag = openid === cfg.superAdmin;
    // 客户端传入"今天 0 点"的时间戳，避免云函数时区差异
    const todayStart = Number(event.todayStart) || 0;
    const todayFilter = todayStart ? { createdAt: _.gte(todayStart) } : {};
    const todayActive = await getRecentTournamentSummaries(todayFilter, 30, openid, false);
    const createStats = await getTodayCreateStats(openid, Date.now(), isSuperFlag);
    return ok({
      user,
      // 创建入口对所有已登录用户开放；赛事操作权限由每场摘要的 canManage 控制。
      canCreate: !!openid,
      isSuper: isSuperFlag,
      hasSuper: !!cfg.superAdmin,
      ...createStats,
      // 已归档与往期比赛不再随首页返回，历史区首次展开时由 listHistory 拉取。
      today: todayActive,
      older: [],
    });
  },

  /* 历史赛事：仅在用户展开历史区时调用，避免每次打开首页都扫历史集合 */
  async listHistory(event) {
    const openid = getOpenId();
    // 客户端传入"今天 0 点"的时间戳，避免云函数时区差异
    const todayStart = Number(event.todayStart) || 0;
    const todayFilter = todayStart ? { createdAt: _.gte(todayStart) } : {};
    const olderFilter = todayStart ? { createdAt: _.lt(todayStart) } : { createdAt: _.lt(0) };
    const [todayArchived, activeOlder] = await Promise.all([
      getRecentTournamentSummaries(todayFilter, 50, openid, true),
      getRecentTournamentSummaries(olderFilter, 50, openid),
    ]);
    return ok({
      // 已归档的比赛进入历史；删除的比赛不再显示。
      older: todayArchived.concat(activeOlder).slice(0, 50),
    });
  },
};
