// pages/index/index.js - 主页（创建比赛 + 今天的比赛 + 历史入口）
const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    user: null,
    isAdmin: false,
    isSuper: false,
    hasSuper: false,
    today: [],
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return api
      .call('home', { todayStart })
      .then((d) => {
        const today = (d.today || []).map((item) =>
          Object.assign({}, item, {
            phaseText:
              item.status === 'registration'
                ? '报名中'
                : item.status === 'draft'
                ? '选人中'
                : item.status === 'battle'
                ? '对战中'
                : '已结束',
          })
        );
        this.setData({
          user: d.user,
          isAdmin: !!d.isAdmin,
          isSuper: !!d.isSuper,
          hasSuper: !!d.hasSuper,
          today,
          loading: false,
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onEditNickname() {
    wx.showModal({
      title: '设置昵称',
      editable: true,
      placeholderText: this.data.user ? this.data.user.nickname : '输入你的昵称',
      success: (res) => {
        if (res.confirm && res.content) {
          api
            .call('saveProfile', { nickname: res.content.trim() })
            .then(() => {
              wx.showToast({ title: '已保存', icon: 'success' });
              this.load();
            })
            .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
        }
      },
    });
  },

  goCreate() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '只有管理员可以创建比赛', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goTournament(e) {
    const item = this.data.today[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.status === 'registration') {
      wx.navigateTo({ url: '/pages/register/register?id=' + item.id });
    } else if (item.status === 'draft') {
      wx.navigateTo({ url: '/pages/draft/draft?id=' + item.id });
    } else {
      wx.navigateTo({ url: '/pages/bracket/bracket?id=' + item.id });
    }
  },
});
