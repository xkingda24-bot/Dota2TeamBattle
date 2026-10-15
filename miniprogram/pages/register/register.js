// pages/register/register.js - 报名（按比赛 id，需暗号）
const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    t: null,
    myReg: null,
    isAdmin: false,
    activeTab: 'captain',
    captainList: [],
    playerList: [],
    secretInput: '',
    secretOk: false,
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
  },

  onShow() {
    this.load();
    this.startPoll();
  },
  onHide() {
    this.stopPoll();
  },
  onUnload() {
    this.stopPoll();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  startPoll() {
    this.stopPoll();
    this._timer = setInterval(() => this.load(true), 8000);
  },
  stopPoll() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  load(silent) {
    if (!silent) this.setData({ loading: true });
    const data = this.id ? { id: this.id } : {};
    const now = new Date();
    data.todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return api
      .call('tournament', data)
      .then((t) => {
        const regs = t.registrations || [];
        const secretOk = !!this.getStoredSecret() || !!t.myReg;
        this.setData({
          t,
          myReg: t.myReg,
          isAdmin: !!t.isAdmin,
          loading: false,
          captainList: regs.filter((r) => r.role === 'captain'),
          playerList: regs.filter((r) => r.role === 'player'),
          secretOk,
        });
      })
      .catch((e) => {
        this.setData({ loading: false, t: null });
        if (!silent) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  getStoredSecret() {
    if (!this.id) return '';
    return wx.getStorageSync('dota2_secret_' + this.id) || '';
  },

  onSecretInput(e) {
    this.setData({ secretInput: e.detail.value });
  },

  onVerifySecret() {
    const t = this.data.t;
    if (!t) return;
    const secret = this.data.secretInput.trim();
    if (!secret) {
      wx.showToast({ title: '请输入报名暗号', icon: 'none' });
      return;
    }
    api
      .call('checkSecret', { id: t.id, secret })
      .then((d) => {
        if (!d.correct) {
          wx.showToast({ title: '暗号错误', icon: 'none' });
          return;
        }
        if (this.id) wx.setStorageSync('dota2_secret_' + this.id, secret);
        this.setData({ secretOk: true, secretInput: '' });
        wx.showToast({ title: '暗号正确', icon: 'success' });
      })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },

  onReg(e) {
    const role = e.currentTarget.dataset.role;
    if (!this.data.t) return;
    if (this.data.myReg) {
      wx.showToast({ title: '你已经报名了', icon: 'none' });
      return;
    }
    const secret = this.getStoredSecret();
    api
      .call('register', { id: this.data.t.id, role, secret })
      .then(() => {
        wx.showToast({ title: '报名成功', icon: 'success' });
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onCancelReg() {
    const t = this.data.t;
    if (!t) return;
    wx.showModal({
      title: '取消报名',
      content: '确定要退出本次报名吗？名额将自动释放',
      success: (res) => {
        if (res.confirm) {
          api
            .call('cancelRegister', { id: t.id })
            .then(() => {
              wx.showToast({ title: '已取消', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onRemoveReg(e) {
    const t = this.data.t;
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    wx.showModal({
      title: '移除报名',
      content: '确定移除 ' + nickname + ' 的报名吗？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('removeRegistration', { id: t.id, openid })
            .then(() => {
              wx.showToast({ title: '已移除', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onEditConfig() {
    const t = this.data.t;
    if (!t) return;
    wx.navigateTo({ url: '/pages/create/create?id=' + t.id });
  },

  onStartDraft() {
    const t = this.data.t;
    if (!t) return;
    wx.showModal({
      title: '开始选人',
      content: '将随机排序 ' + t.N + ' 位队长并按蛇形顺序选人，确定开始？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('startDraft', { id: t.id })
            .then(() => {
              wx.showToast({ title: '选人已开始', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onDelete() {
    const t = this.data.t;
    if (!t) return;
    wx.showModal({
      title: '删除比赛',
      content: '将永久删除「' + t.name + '」的全部数据（报名/选人/赛程），不可恢复！确定删除？',
      confirmText: '删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: t.id })
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'success' });
              setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  goBack() {
    wx.navigateBack();
  },
});
