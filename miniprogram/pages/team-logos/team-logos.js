const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    loadError: '',
    accessDenied: false,
    activeLogos: [],
    hiddenLogos: [],
    busy: false,
  },

  onShow() {
    this.load();
  },

  load() {
    this.setData({ loading: true, loadError: '' });
    return api
      .call('teamLogoList')
      .then((result) => {
        const presets = Array.isArray(result.presets) ? result.presets : [];
        const activeLogos = Array.isArray(result.logos) ? result.logos : [];
        if (!result.isSuper) {
          this.setData({ loading: false, accessDenied: true, activeLogos: [], hiddenLogos: [] });
          return;
        }
        this.setData({
          loading: false,
          accessDenied: false,
          loadError: '',
          activeLogos,
          hiddenLogos: presets.filter((item) => !item.enabled),
        });
      })
      .catch((e) => this.setData({ loading: false, loadError: e.message || '队标列表加载失败' }));
  },

  retryLoad() {
    this.load();
  },

  move(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index);
    const direction = Number(e.currentTarget.dataset.direction);
    const target = index + direction;
    const logos = this.data.activeLogos.slice();
    if (index < 0 || target < 0 || target >= logos.length) return;
    const current = logos[index];
    logos[index] = logos[target];
    logos[target] = current;
    this.setData({ busy: true, activeLogos: logos });
    api
      .call('teamLogoReorder', { logoIds: logos.map((item) => item.id) })
      .then(() => this.setData({ busy: false }))
      .catch((e) => {
        wx.showToast({ title: e.message || '排序保存失败', icon: 'none' });
        this.setData({ busy: false });
        this.load();
      });
  },

  remove(e) {
    if (this.data.busy) return;
    const logo = this.data.activeLogos[Number(e.currentTarget.dataset.index)];
    if (!logo) return;
    wx.showModal({
      title: '删除队标',
      content: '删除“' + logo.name + '”后，新队伍将不能选择它；已使用的队标和历史赛事不受影响，之后仍可重新增加。',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        api
          .call('teamLogoDelete', { logoId: logo.id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            return this.load();
          })
          .catch((e) => wx.showToast({ title: e.message || '操作失败', icon: 'none' }))
          .finally(() => this.setData({ busy: false }));
      },
    });
  },

  restore(e) {
    if (this.data.busy) return;
    const logo = this.data.hiddenLogos[Number(e.currentTarget.dataset.index)];
    if (!logo) return;
    this.setData({ busy: true });
    api
      .call('teamLogoSave', { logoId: logo.id })
      .then(() => {
        wx.showToast({ title: '已恢复', icon: 'success' });
        return this.load();
      })
      .catch((e) => wx.showToast({ title: e.message || '恢复失败', icon: 'none' }))
      .finally(() => this.setData({ busy: false }));
  },
});
