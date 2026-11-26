const ICON_COLOR = '#8d96a3';
const ICON_COLOR_ACTIVE = '#e8c27c';

const ICON_PATHS = {
  home: '<path d="M3.5 11.5 12 4l8.5 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5.5h4V20"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5H4.5v1.5A3.5 3.5 0 0 0 8 10M16 5h3.5v1.5A3.5 3.5 0 0 1 16 10"/><path d="M12 13v3.5M9 20h6M10 16.5h4l.8 3.5H9.2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.8 4.1-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>',
};

const tabIcon = (name, color) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`
);

const withIcons = (item, iconName) => ({
  ...item,
  icon: tabIcon(iconName, ICON_COLOR),
  iconActive: tabIcon(iconName, ICON_COLOR_ACTIVE),
});

Component({
  data: {
    selected: 0,
    safeAreaBottom: 0,
    list: [
      withIcons({ pagePath: '/pages/index/index', text: '主页' }, 'home'),
      withIcons({ pagePath: '/pages/blacklist/blacklist', text: '禁赛名单' }, 'ban'),
      withIcons({ pagePath: '/pages/history/history', text: '历史赛事' }, 'trophy'),
      withIcons({ pagePath: '/pages/staff/staff', text: '我的' }, 'user'),
    ],
  },

  lifetimes: {
    attached() {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const safeAreaBottom = win && win.safeArea
        ? Math.max(0, Number(win.screenHeight) - Number(win.safeArea.bottom))
        : 0;
      this.setData({ safeAreaBottom: Number.isFinite(safeAreaBottom) ? safeAreaBottom : 0 });
    },
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
