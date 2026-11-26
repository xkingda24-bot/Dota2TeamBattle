// pages/staff/staff.js - 我的（资料 + 超管用户列表查看）
const { buildCareerView, summarizeCareer } = require('../../utils/career');
const api = require('../../utils/api');
const { selectTabBar } = require('../../utils/tab-bar');

const { formatRolesText } = require('../../utils/roles');

function fmtRoles(roles) {
  return formatRolesText(roles, ' / ');
}

function fmtMmr(mmr) {
  if (mmr === null || mmr === undefined || mmr === '') return '';
  return '天梯 ' + mmr;
}

Page({
  data: {
    loading: true,
    hasLoaded: false,
    loadError: '',
    refreshError: false,
    user: null,
    superAdmin: null,
    superAdminOpenid: '',
    isSuper: false,
    isAdmin: false,
    canInitializeSuperAdmin: false,
    bootstrapOpenid: '',
    career: null,
    careerLoading: false,
    careerError: '',
  },

  onShow() {
    selectTabBar(this, 3);
    this.load();
  },

  load() {
    this.loadCareer();
    const hadData = this.data.hasLoaded;
    if (!hadData) this.setData({ loading: true, loadError: '' });
    return api
      .call('getStaff')
      .then((d) => {
        const raw = d.user || null;
        const user = raw
          ? Object.assign({}, raw, {
              mmrText: fmtMmr(raw.mmr),
              rolesText: fmtRoles(raw.roles),
            })
          : null;
        this.setData({
          user,
          superAdmin: d.superAdmin,
          superAdminOpenid: d.superAdminOpenid || (d.superAdmin && d.superAdmin.openid) || '',
          isSuper: !!d.isSuper,
          isAdmin: !!d.isAdmin,
          canInitializeSuperAdmin: !!d.canInitializeSuperAdmin,
          bootstrapOpenid: d.bootstrapOpenid || '',
          loading: false,
          hasLoaded: true,
          loadError: '',
          refreshError: false,
        });
      })
      .catch((e) => {
        // A fresh CloudBase environment has no collections yet. Only an
        // INITIAL_SUPER_ADMIN_OPENID-matched caller can create them, and this
        // one-time bootstrap is attempted only after the normal request fails.
        if (!this._databaseInitAttempted) {
          this._databaseInitAttempted = true;
          return api.call('initializeDatabase').then(() => this.load()).catch(() => this.showLoadError(e));
        }
        this.showLoadError(e);
      });
  },

  /* 我的生涯摘要：独立拉取，失败不影响资料卡；requestId 防止连续 onShow 时旧响应覆盖新数据 */
  loadCareer() {
    const requestId = (this._careerRequestId || 0) + 1;
    this._careerRequestId = requestId;
    this.setData({ careerLoading: true, careerError: '' });
    return api
      .call('getPlayerProfile', {})
      .then((result) => {
        if (requestId !== this._careerRequestId) return;
        const career = summarizeCareer(buildCareerView(result, ''));
        this.setData({ careerLoading: false, career });
      })
      .catch((error) => {
        if (requestId !== this._careerRequestId) return;
        this.setData({
          careerLoading: false,
          careerError: (error && error.message) || '生涯数据暂时无法加载',
        });
      });
  },

  onCareerPlacement(event) {
    const id = String((event.detail && event.detail.id) || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/bracket/bracket?id=' + encodeURIComponent(id) + '&view=settlement' });
  },

  showLoadError(e) {
    const hasData = this.data.hasLoaded;
    this.setData({
      loading: false,
      loadError: hasData ? '' : (e.message || '加载失败，请重试'),
      refreshError: hasData,
    });
    if (!hasData) wx.showToast({ title: e.message, icon: 'none' });
  },

  retryLoad() {
    this._databaseInitAttempted = false;
    this.load();
  },

  /* 超管：用户列表已迁移为独立页面 */
  goUserList() {
    if (!this.data.isSuper) return;
    wx.navigateTo({ url: '/pages/user-list/user-list' });
  },

  /* 资料编辑已迁移为独立页面，保存返回后 onShow 自动刷新 */
  goProfileEdit() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  goCardStyle() {
    if (!this.data.user) {
      wx.showToast({ title: '请先设置个人资料', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/card-style/card-style' });
  },

  /* 我的生涯：带自己的 openid 进档案页，未设置资料也能看（会提示还没有名片） */
  goPlayerProfile() {
    const openid = String((this.data.user && this.data.user.openid) || '');
    wx.navigateTo({ url: '/pages/player/player' + (openid ? '?openid=' + encodeURIComponent(openid) : '') });
  },

  initSuper() {
    wx.showModal({
      title: '初始化最高管理员',
      content: '当前微信账号已被指定为初始最高管理员。初始化后，你将可以查看全部用户并管理所有比赛。确定继续？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('initSuperAdmin')
            .then(() => {
              wx.showToast({ title: '初始化成功', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  copyBootstrapOpenid() {
    if (!this.data.bootstrapOpenid) return;
    wx.setClipboardData({
      data: this.data.bootstrapOpenid,
      success: () => wx.showToast({ title: '已复制本人 OpenID', icon: 'success' }),
    });
  },
});
