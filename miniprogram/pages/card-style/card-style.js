const api = require('../../utils/api');
const { DEFAULT_CARD_STYLE, CARD_STYLE_OPTIONS, normalizeCardStyle } = require('../../utils/card-style');

const { formatRolesText } = require('../../utils/roles');

Page({
  data: {
    loading: true,
    saving: false,
    user: null,
    cardStyle: DEFAULT_CARD_STYLE,
    previewPlayer: {},
    options: CARD_STYLE_OPTIONS,
  },

  onLoad() {
    this.load();
  },

  goProfile() {
    wx.navigateBack();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });
    return api.call('getStaff').then((data) => {
      const user = data.user || null;
      if (!user) {
        this.setData({ loading: false, user: null });
        return;
      }
      const roles = Array.isArray(user.roles) ? user.roles.filter((role) => role >= 1 && role <= 5) : [];
      this.setData({
        loading: false,
        user,
        cardStyle: normalizeCardStyle(user.cardStyle),
        previewPlayer: Object.assign({}, user, {
          nickname: user.nickname,
          mmr: user.mmr,
          rolesText: formatRolesText(roles, ' / '),
          signature: user.signature || '',
        }),
      });
    }).catch((err) => {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '名片装扮加载失败', icon: 'none' });
    });
  },

  selectOption(e) {
    const group = e.currentTarget.dataset.group;
    const value = e.currentTarget.dataset.value;
    if (!group || !value || !Object.prototype.hasOwnProperty.call(this.data.cardStyle, group)) return;
    const next = Object.assign({}, this.data.cardStyle);
    next[group] = value;
    this.setData({ cardStyle: next });
  },

  resetStyle() {
    this.setData({ cardStyle: Object.assign({}, DEFAULT_CARD_STYLE) });
  },

  saveStyle() {
    if (this.data.saving || !this.data.user) return;
    this.setData({ saving: true });
    api.call('saveCardStyle', { cardStyle: this.data.cardStyle }).then((data) => {
      this.setData({ saving: false, cardStyle: normalizeCardStyle(data.cardStyle) });
      wx.showToast({ title: '名片已保存', icon: 'success' });
    }).catch((err) => {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败，请重试', icon: 'none' });
    });
  },
});
