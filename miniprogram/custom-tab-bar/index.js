Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '主页' },
      { pagePath: '/pages/blacklist/blacklist', text: '禁赛名单' },
      { pagePath: '/pages/history/history', text: '历史赛事' },
      { pagePath: '/pages/staff/staff', text: '我的' },
    ],
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.list[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
    },
  },
});
