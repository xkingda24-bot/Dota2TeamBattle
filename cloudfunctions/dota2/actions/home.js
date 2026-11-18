/**
 * 首页与历史列表动作。从原 index.js 拆出（纯搬移）。
 *
 * 历史列表（listHistory）改为 createdAt 游标分页：前端把上一页返回的 nextCursor 原样带回，
 * 不再用固定 50 条 + skip 翻页，历史赛事再多也不会被静默截断。
 */
const { _ } = require('../db');
const { ok, getOpenId } = require('../utils');
const { getUser } = require('../users');
const { getAdminsConfig } = require('../permissions');
const { getRecentTournamentSummaries, getTodayCreateStats, queryHistoryPage } = require('../tournaments');
const { listSeasonOptions, seasonOfTimestamp } = require('../season-window');

module.exports = {
  /* 主页数据：今天的比赛 + 我的身份（历史赛事走 listHistory，收起状态下不再预取） */
  async home(event) {
    const openid = getOpenId();
    const [user, cfg] = await Promise.all([getUser(openid), getAdminsConfig()]);
    const isSuperFlag = openid === cfg.superAdmin;
    const isAdminFlag = isSuperFlag || (Array.isArray(cfg.admins) && cfg.admins.indexOf(openid) >= 0);
    // 客户端传入"今天 0 点"的时间戳，避免云函数时区差异
    const todayStart = Number(event.todayStart) || 0;
    const todayFilter = todayStart ? { createdAt: _.gte(todayStart) } : {};
    const todayActive = await getRecentTournamentSummaries(todayFilter, 30, openid, false);
    const createStats = await getTodayCreateStats(openid, Date.now(), isAdminFlag);
    return ok({
      user,
      // 仅普通管理员和超级管理员可创建；普通用户不显示创建入口。
      canCreate: isAdminFlag,
      isAdmin: isAdminFlag,
      isSuper: isSuperFlag,
      hasSuper: !!cfg.superAdmin,
      ...createStats,
      // 已归档与往期比赛不再随首页返回，历史区首次展开时由 listHistory 拉取。
      today: todayActive,
      older: [],
    });
  },

  /* 历史赛事：仅在用户展开历史区 / 打开历史页时调用，避免每次打开首页都扫历史集合 */
  async listHistory(event) {
    const openid = getOpenId();
    const page = await queryHistoryPage({
      openid,
      todayStart: Number(event && event.todayStart) || 0,
      limit: event && event.limit,
      cursorCreatedAt: event && event.cursorCreatedAt,
      cursorId: event && event.cursorId,
      seasonId: event && event.seasonId,
      keyword: event && event.keyword,
    });
    const current = seasonOfTimestamp(Date.now());
    return ok({
      // 兼容旧字段名：older = 本页历史赛事；下一页把 nextCursor 原样带回即可。
      older: page.items,
      hasMore: !!page.hasMore,
      nextCursor: page.cursor,
      pageSize: page.desc.limit,
      seasonId: page.desc.seasonId,
      keyword: page.desc.keyword,
      seasons: listSeasonOptions(),
      currentSeasonId: current ? current.seasonId : '',
    });
  },
};
