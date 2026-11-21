const api = require('../../utils/api');
const { decorateBan } = require('../../utils/blacklist-view');

Page({
  data: {
    items: [],
    total: 0,
    isSuper: false,
    loading: true,
    error: '',
    editorVisible: false,
    editorTarget: null,
    saving: false,
    liftingOpenid: '',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    const requestId = (this._requestId || 0) + 1;
    this._requestId = requestId;
    if (!this.data.items.length) this.setData({ loading: true });
    this.setData({ error: '' });
    return api.call('listBlacklist')
      .then((result) => {
        if (requestId !== this._requestId) return;
        const serverTime = Number(result.serverTime) || Date.now();
        this.setData({
          items: (result.items || []).map((item) => decorateBan(item, serverTime)),
          total: Number(result.total) || 0,
          isSuper: !!result.isSuper,
          loading: false,
          error: '',
        });
      })
      .catch((error) => {
        if (requestId !== this._requestId) return;
        this.setData({ loading: false, error: error.message || '黑名单加载失败，请重试' });
      });
  },

  retry() {
    this.load();
  },

  onOpenEditor(e) {
    if (!this.data.isSuper || this.data.saving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    const target = (this.data.items || []).find((item) => item.openid === openid);
    if (!target) return;
    this.setData({ editorVisible: true, editorTarget: Object.assign({}, target, { ban: target }) });
  },

  onCloseEditor() {
    if (!this.data.saving) this.setData({ editorVisible: false, editorTarget: null });
  },

  onSubmitBan(e) {
    if (!this.data.isSuper || this.data.saving) return;
    const detail = e.detail || {};
    this.setData({ saving: true });
    api.call('setUserBan', detail)
      .then(() => {
        this.setData({ saving: false, editorVisible: false, editorTarget: null });
        wx.showToast({ title: '禁赛已更新', icon: 'success' });
        this.load();
      })
      .catch((error) => {
        this.setData({ saving: false });
        wx.showToast({ title: error.message || '禁赛设置失败', icon: 'none' });
      });
  },

  onLiftBan(e) {
    if (!this.data.isSuper || this.data.liftingOpenid || this.data.saving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    const target = (this.data.items || []).find((item) => item.openid === openid);
    if (!target) return;
    wx.showModal({
      title: '解除禁赛',
      content: '解除后 ' + target.nickname + ' 将立即恢复报名参赛资格。确定继续？',
      confirmText: '确认解除',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ liftingOpenid: openid });
        api.call('liftUserBan', { targetOpenid: openid })
          .then(() => {
            this.setData({ liftingOpenid: '' });
            wx.showToast({ title: '已解除禁赛', icon: 'success' });
            this.load();
          })
          .catch((error) => {
            this.setData({ liftingOpenid: '' });
            wx.showToast({ title: error.message || '解除失败', icon: 'none' });
          });
      },
    });
  },
});
