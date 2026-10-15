// components/nav-bar/index.js - 自定义导航栏（左上主页 / 右上管理员，动态避让胶囊按钮）
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
    capsuleRight: 96, // px：右按钮右边缘相对屏幕右缘的偏移（默认值，运行时按胶囊位置计算）
  },

  lifetimes: {
    attached() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const statusBarHeight = (win && win.statusBarHeight) || 20;
      const windowWidth = (win && win.windowWidth) || 375;
      let navHeight = 44;
      let capsuleRight = 96;
      if (wx.getMenuButtonBoundingClientRect) {
        try {
          const menu = wx.getMenuButtonBoundingClientRect();
          if (menu && menu.height) {
            navHeight = (menu.top - statusBarHeight) * 2 + menu.height;
            // 右按钮右边缘 = 胶囊左边缘再往左 8px，保证不被右上角胶囊（三个点）遮挡
            capsuleRight = windowWidth - menu.left + 8;
          }
        } catch (e) {
          /* 保留默认 */
        }
      }
      this.setData({ statusBarHeight, navHeight, capsuleRight });
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
