// components/nav-bar/index.js - 页面标题栏；四个主导航入口统一由底部 tabBar 承担
const TAB_PAGES = [
  'pages/index/index',
  'pages/blacklist/blacklist',
  'pages/history/history',
  'pages/staff/staff',
];

const BACK_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e8c27c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5 8 12l6.5 7"/></svg>'
);

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
    showBack: false,
    backIcon: BACK_ICON,
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
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const current = pages.length ? pages[pages.length - 1] : null;
      const route = current && current.route ? current.route : '';
      // tab 页是顶级入口，不显示返回键；其余页面（含分享直达）都提供返回出口
      const showBack = pages.length > 0 && TAB_PAGES.indexOf(route) === -1;
      this.setData({ statusBarHeight, navHeight, showBack });
    },
  },

  methods: {
    goBack() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        // 分享卡片/扫码直达二级页时页面栈只有一层，返回兜底到首页
        wx.switchTab({ url: '/pages/index/index' });
      }
    },
  },
});
