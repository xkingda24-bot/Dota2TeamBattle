// components/nav-bar/index.js - 自定义导航栏（左上主页 / 右上管理员）
Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    showHome: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    statusBarHeight: 20,
    navHeight: 44,
  },

  lifetimes: {
    attached() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = (win && win.statusBarHeight) || 20;
      let navHeight = 44;
      if (wx.getMenuButtonBoundingClientRect) {
        try {
          const menu = wx.getMenuButtonBoundingClientRect();
          if (menu && menu.height) {
            navHeight = (menu.top - statusBarHeight) * 2 + menu.height;
          }
        } catch (e) {
          /* 保留默认 */
        }
      }
      this.setData({ statusBarHeight, navHeight });
    },
  },

  methods: {
    goHome() {
      wx.reLaunch({ url: '/pages/index/index' });
    },
    goStaff() {
      wx.navigateTo({ url: '/pages/staff/staff' });
    },
  },
});
