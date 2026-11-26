// components/nav-bar/index.js - 页面标题栏；四个主导航入口统一由底部 tabBar 承担
Component({
  properties: {
    title: {
      type: String,
      value: '',
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
          if (menu && menu.height) navHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        } catch (e) {
          /* 保留默认 */
        }
      }
      this.setData({ statusBarHeight, navHeight });
    },
  },
});
