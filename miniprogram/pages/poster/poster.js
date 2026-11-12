// pages/poster/poster.js - 战报长图：赛事战报（冠军/名次/感言）与生涯战报（数据/搭档/战绩）
const api = require('../../utils/api');
const { drawPoster, POSTER_WIDTH, POSTER_HEIGHT } = require('../../utils/poster');
const { formatDateTime } = require('../../utils/date-time');
const { getSeasonCardStats } = require('../../utils/season-points-cache');
const { formatHonors } = require('../../utils/honors');
const { formatRolesText } = require('../../utils/roles');

const FORMAT_TEXT = {
  double: '双败淘汰',
  single: '单败淘汰',
  singleRank: '单败排位',
  pick8: 'CBF 交叉突围',
};

function formatDate(timestamp) {
  const text = formatDateTime(timestamp);
  return text ? text.slice(0, 10) : '';
}

function nowText() {
  return formatDateTime(Date.now()).slice(0, 16);
}

function formatPoints(value) {
  const points = Number(value) || 0;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/* 赛事战报：冠军、名次、最长的一条感言（内容最有得看） */
function buildTournamentData(tournament) {
  const t = tournament || {};
  const items = (t.standings && Array.isArray(t.standings.items)) ? t.standings.items : [];
  const champion = items.find((item) => item && item.rank === 1) || null;
  const members = champion && Array.isArray(champion.members)
    ? champion.members.map((member) => member.nickname || '队员').filter(Boolean)
    : [];
  const comments = (Array.isArray(t.comments) ? t.comments : []).filter((comment) => comment && comment.text);
  const quote = comments.slice().sort((a, b) => String(b.text).length - String(a.text).length)[0] || null;
  const metaParts = [
    FORMAT_TEXT[t.bracketType] || FORMAT_TEXT.double,
    t.N ? t.N + ' 队 · 每队 ' + t.K + ' 人' : '',
    t.time || '',
    formatDate(t.createdAt),
  ].filter(Boolean);
  return {
    title: t.name || '未命名赛事',
    metaText: metaParts.join(' · '),
    championName: (champion && champion.teamName) || (t.champion && t.champion.name) || '',
    championMembers: members.length ? '队员：' + members.join(' · ') : '',
    standings: items
      .filter((item) => item && item.rank !== 1 && item.rank != null)
      .map((item) => ({ label: item.label || '第 ' + item.rank + ' 名', teamName: item.teamName || '' })),
    quoteText: quote ? String(quote.text) : '',
    quoteAuthor: quote ? String(quote.nickname || '') : '',
    generatedAt: nowText(),
  };
}

/* 生涯战报：核心数据 + 赛季积分 + 最佳搭档 + 最近战绩 */
function buildProfileData(result, season) {
  const profile = (result && result.profile) || {};
  const stats = (result && result.stats) || {};
  const seasonPoints = season ? formatPoints(season.points) : '';
  const metaParts = [
    profile.mmr ? '天梯 ' + profile.mmr : '',
    Array.isArray(profile.roles) && profile.roles.length ? formatRolesText(profile.roles, ' / ') : '',
    profile.signature || '',
  ].filter(Boolean);
  return {
    nickname: profile.nickname || '玩家',
    metaText: metaParts.join(' · '),
    playedTournaments: Number(stats.playedTournaments) || 0,
    winRate: Number(stats.winRate) || 0,
    wins: Number(stats.wins) || 0,
    losses: Number(stats.losses) || 0,
    championships: Number(stats.championships) || 0,
    bestStreak: Number(stats.bestStreak) || 0,
    honorsText: formatHonors(stats),
    seasonPoints: season && Number(season.points) > 0 ? seasonPoints : '',
    seasonMeta: season ? '已结算 ' + (Number(season.matches) || 0) + ' 场' : '',
    partners: (Array.isArray(stats.partners) ? stats.partners : []).map((partner) => ({
      nickname: partner.nickname || '队友',
      matches: Number(partner.matches) || 0,
      winRate: Number(partner.winRate) || 0,
    })),
    recent: (Array.isArray(stats.placements) ? stats.placements : []).slice(0, 3).map((item) => ({
      label: item.label || '',
      name: item.name || '',
      dateText: formatDate(item.date),
    })),
    generatedAt: nowText(),
  };
}

Page({
  data: {
    type: 'tournament',
    navTitle: '赛事战报',
    loading: true,
    error: '',
    ready: false,
    exporting: true,
    canvasW: 327,
    canvasH: 523,
    tempFilePath: '',
  },

  onLoad(options) {
    this.type = options && options.type === 'profile' ? 'profile' : 'tournament';
    this.id = String((options && options.id) || '');
    this.openid = String((options && options.openid) || '');
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = Math.min((win && win.windowWidth ? win.windowWidth : 375) - 48, 375);
    this.setData({
      type: this.type,
      navTitle: this.type === 'profile' ? '生涯战报' : '赛事战报',
      canvasW: width,
      canvasH: Math.round(width * (POSTER_HEIGHT / POSTER_WIDTH)),
    });
    this.load();
  },

  onShareAppMessage() {
    return {
      title: this.type === 'profile' ? '我的刀塔生涯战报' : '赛事战报',
      path: this.type === 'profile'
        ? '/pages/player/player' + (this.openid ? '?openid=' + encodeURIComponent(this.openid) : '')
        : '/pages/bracket/bracket' + (this.id ? '?id=' + encodeURIComponent(this.id) : ''),
    };
  },

  load() {
    this.setData({ loading: true, error: '', ready: false });
    const task = this.type === 'profile' ? this.loadProfile() : this.loadTournament();
    task
      .then((data) => {
        this.posterData = data;
        this.setData({ loading: false, ready: true }, () => this.render());
      })
      .catch((error) => {
        this.setData({
          loading: false,
          error: (error && error.message) || '战报生成失败，请稍后重试',
        });
      });
  },

  loadTournament() {
    if (!this.id) return Promise.reject(new Error('缺少赛事编号'));
    return api.call('tournament', { id: this.id }).then(buildTournamentData);
  },

  loadProfile() {
    const payload = this.openid ? { openid: this.openid } : {};
    return api
      .call('getPlayerProfile', payload)
      .then((result) => getSeasonCardStats(result && result.openid).then((season) => buildProfileData(result, season)));
  },

  render() {
    const query = wx.createSelectorQuery().in(this);
    query
      .select('#poster')
      .fields({ node: true, size: true })
      .exec((res) => {
        const item = res && res[0];
        if (!item || !item.node) {
          this.setData({ ready: false, error: '画布初始化失败，请重试' });
          return;
        }
        const canvas = item.node;
        canvas.width = POSTER_WIDTH;
        canvas.height = POSTER_HEIGHT;
        const ctx = canvas.getContext('2d');
        try {
          drawPoster(ctx, this.type, this.posterData);
        } catch (error) {
          this.setData({ ready: false, error: '绘制失败：' + ((error && error.message) || '未知错误') });
          return;
        }
        this.canvas = canvas;
        this.exportPoster();
      });
  },

  exportPoster() {
    if (!this.canvas) return;
    this.setData({ exporting: true });
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      x: 0,
      y: 0,
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      destWidth: POSTER_WIDTH,
      destHeight: POSTER_HEIGHT,
      fileType: 'png',
      success: (res) => this.setData({ exporting: false, tempFilePath: res.tempFilePath }),
      fail: (error) => this.setData({
        exporting: false,
        error: '图片导出失败：' + ((error && error.errMsg) || '请重试'),
      }),
    });
  },

  retryLoad() {
    this.load();
  },

  savePoster() {
    const filePath = this.data.tempFilePath;
    if (!filePath) {
      wx.showToast({ title: '图片还没生成好', icon: 'none' });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (error) => {
        const message = String((error && error.errMsg) || '');
        if (/auth deny|authorize|permission|隐私/i.test(message)) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存战报需要访问相册，请在设置里允许「添加到相册」。',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) wx.openSetting();
            },
          });
          return;
        }
        if (/cancel/i.test(message)) return;
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      },
    });
  },

  sharePoster() {
    const path = this.data.tempFilePath;
    if (!path) {
      wx.showToast({ title: '图片还没生成好', icon: 'none' });
      return;
    }
    // 基础库 2.14.3+ 支持把图片直接转发到聊天；低版本降级为预览后长按转发
    if (wx.showShareImageMenu) {
      wx.showShareImageMenu({
        path,
        fail: () => wx.showToast({ title: '长按图片可直接转发', icon: 'none' }),
      });
      return;
    }
    wx.previewImage({ urls: [path] });
    wx.showToast({ title: '长按图片转发给好友', icon: 'none' });
  },

  previewPoster() {
    if (!this.data.tempFilePath) return;
    wx.previewImage({ urls: [this.data.tempFilePath] });
  },
});
