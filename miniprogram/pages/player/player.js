// pages/player/player.js - 选手生涯档案（只读：名片 + 战绩统计 + 名次历史 + 最佳搭档）
const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/date-time');
const { getSeasonCardStats } = require('../../utils/season-points-cache');
const { formatHonors } = require('../../utils/honors');

const RANK_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };

function formatPoints(value) {
  const points = Number(value) || 0;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function formatDate(timestamp) {
  const text = formatDateTime(timestamp);
  return text ? text.slice(0, 10) : '';
}

/**
 * 服务端返回的 stats 直接渲染有风险（缺字段、名次为空），这里统一兜底，
 * 页面模板不写任何默认值逻辑，避免各处口径不一致。
 */
function buildView(result, fallbackOpenid) {
  const profile = (result && result.profile) || {};
  const stats = (result && result.stats) || {};
  const openid = String((result && result.openid) || fallbackOpenid || '');
  const placements = Array.isArray(stats.placements) ? stats.placements : [];
  const partners = Array.isArray(stats.partners) ? stats.partners : [];
  return {
    openid,
    isSelf: !!(result && result.isSelf),
    hasProfile: !!(profile.nickname || profile.mmr),
    profile: Object.assign({}, profile, { openid }),
    navTitle: profile.nickname ? profile.nickname + ' 的生涯' : '生涯档案',
    stats: {
      registered: Number(stats.registered) || 0,
      playedTournaments: Number(stats.playedTournaments) || 0,
      matches: Number(stats.matches) || 0,
      wins: Number(stats.wins) || 0,
      losses: Number(stats.losses) || 0,
      winRate: Number(stats.winRate) || 0,
      championships: Number(stats.championships) || 0,
      runnerUps: Number(stats.runnerUps) || 0,
      thirds: Number(stats.thirds) || 0,
      captainTimes: Number(stats.captainTimes) || 0,
      bestStreak: Number(stats.bestStreak) || 0,
      currentStreak: Number(stats.currentStreak) || 0,
    },
    honorsText: formatHonors(stats),
    placements: placements.map((item, index) => ({
      key: (item.id || 'placement') + '-' + index,
      id: String(item.id || ''),
      name: String(item.name || '未命名赛事'),
      teamName: String(item.teamName || ''),
      dateText: formatDate(item.date),
      label: String(item.label || (item.rank ? '第 ' + item.rank + ' 名' : '名次待核实')),
      rankClass: RANK_CLASS[Number(item.rank)] || '',
      recordText: item.matches ? item.wins + ' 胜 ' + item.losses + ' 负' : '未记录赛果',
      isCaptain: !!item.isCaptain,
    })),
    partners: partners.map((item, index) => ({
      key: (item.openid || 'partner') + '-' + index,
      openid: String(item.openid || ''),
      nickname: String(item.nickname || '队友'),
      matches: Number(item.matches) || 0,
      wins: Number(item.wins) || 0,
      winRate: Number(item.winRate) || 0,
    })),
  };
}

Page({
  data: {
    loading: true,
    loadError: '',
    openid: '',
    isSelf: false,
    hasProfile: false,
    navTitle: '生涯档案',
    profile: {},
    stats: {
      registered: 0,
      playedTournaments: 0,
      matches: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      championships: 0,
      runnerUps: 0,
      thirds: 0,
      captainTimes: 0,
      bestStreak: 0,
      currentStreak: 0,
    },
    honorsText: '0 冠 0 亚 0 季',
    placements: [],
    partners: [],
    // 本赛季数据由 seasonPoints 云函数提供，和名片上的数字同源
    seasonReady: false,
    seasonPoints: '0',
    seasonMatches: '0',
    seasonHonorsText: '',
  },

  onLoad(options) {
    this.openid = String((options && options.openid) || '');
    this.load();
  },

  onShareAppMessage() {
    const nickname = (this.data.profile && this.data.profile.nickname) || '玩家';
    return {
      title: nickname + ' 的刀塔生涯档案 · ' + this.data.honorsText,
      path: '/pages/player/player' + (this.data.openid ? '?openid=' + encodeURIComponent(this.data.openid) : ''),
    };
  },

  load() {
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    this.setData({ loading: true, loadError: '' });
    const payload = this.openid ? { openid: this.openid } : {};
    return api
      .call('getPlayerProfile', payload)
      .then((result) => {
        if (requestId !== this._requestId) return null;
        const view = buildView(result, this.openid);
        this.setData(Object.assign({ loading: false, loadError: '' }, view));
        return getSeasonCardStats(view.openid).then((season) => {
          if (requestId !== this._requestId || !season) return;
          this.setData({
            seasonReady: true,
            seasonPoints: formatPoints(season.points),
            seasonMatches: String(Number(season.matches) || 0),
            seasonHonorsText: formatHonors(season.honors),
          });
        });
      })
      .catch((error) => {
        if (requestId !== this._requestId) return;
        this.setData({ loading: false, loadError: (error && error.message) || '生涯数据暂时无法加载' });
      });
  },

  retryLoad() {
    this.load();
  },

  onTapPartner(event) {
    const openid = String((event.currentTarget.dataset && event.currentTarget.dataset.openid) || '');
    if (!openid || openid === this.data.openid) return;
    wx.navigateTo({ url: '/pages/player/player?openid=' + encodeURIComponent(openid) });
  },

  onTapPlacement(event) {
    const id = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/bracket/bracket?id=' + encodeURIComponent(id) + '&view=settlement' });
  },

  generatePoster() {
    if (!this.data.openid) return;
    wx.navigateTo({
      url: '/pages/poster/poster?type=profile&openid=' + encodeURIComponent(this.data.openid),
    });
  },
});
