// pages/history/history.js - 历史比赛（列表 + 详情）
const api = require('../../utils/api');

const BO_LIST = ['BO1', 'BO3', 'BO5'];

Page({
  data: {
    mode: 'list', // list | detail
    loading: true,
    older: [],
    t: null,
    ubMatches: [],
    lbMatches: [],
    gf: null,
  },

  onLoad(options) {
    if (options && options.id) {
      this.id = options.id;
      this.setData({ mode: 'detail' });
    } else {
      this.id = '';
      this.setData({ mode: 'list' });
    }
  },

  onShow() {
    this.load();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });
    if (this.data.mode === 'detail') return this.loadDetail();
    return this.loadList();
  },

  loadList() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return api
      .call('home', { todayStart })
      .then((d) => {
        const older = (d.older || []).map((item) =>
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
        this.setData({ older, loading: false });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  loadDetail() {
    return api
      .call('tournament', { id: this.id })
      .then((t) => {
        const matches = (t.matches || []).map((m) =>
          Object.assign({}, m, { boIndex: Math.max(0, BO_LIST.indexOf(m.bo)) })
        );
        this.setData({
          t,
          ubMatches: matches.filter((m) => m.stage === 'upper' || (m.stage || '').indexOf('UB') === 0),
          lbMatches: matches.filter((m) => m.stage === 'lower' || (m.stage || '').indexOf('LB') === 0),
          gf: matches.find((m) => m.isChampionMatch) || null,
          loading: false,
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  goDetail(e) {
    const item = this.data.older[e.currentTarget.dataset.index];
    if (!item) return;
    this.id = item.id;
    this.setData({ mode: 'detail' });
    this.loadDetail();
  },

  backList() {
    this.id = '';
    this.setData({ mode: 'list', t: null });
    this.loadList();
  },

  // 查看晋级图（只读模式：不支持修改）
  goTree() {
    if (!this.id) return;
    wx.navigateTo({ url: '/pages/bracket/bracket?id=' + this.id + '&readonly=1' });
  },
});
