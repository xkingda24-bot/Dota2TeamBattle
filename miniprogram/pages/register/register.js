// pages/register/register.js - 报名（按比赛 id，需暗号；支持替补与队长队名）
const api = require('../../utils/api');

const ROLE_LABELS = ['', '1号位', '2号位', '3号位', '4号位', '5号位'];

function fmtRoles(roles) {
  const arr = Array.isArray(roles) ? roles.filter((v) => v >= 1 && v <= 5) : [];
  return arr.length ? arr.map((v) => ROLE_LABELS[v]).join('/') : '';
}

function fmtReg(r) {
  return Object.assign({}, r, {
    mmrText: r.mmr ? '天梯 ' + r.mmr : '',
    rolesText: fmtRoles(r.roles),
    roleText: r.role === 'captain' ? '队长' : r.role === 'waitlist' ? '替补' : '队员',
  });
}

Page({
  data: {
    loading: true,
    t: null,
    myReg: null,
    isAdmin: false,
    activeTab: 'captain',
    captainList: [],
    playerList: [],
    waitlistList: [],
    secretInput: '',
    secretOk: false,
    // 队长队名
    teamNameInput: '',
    teamNameSaving: false,
    teamNameDirty: false, // 输入框正在编辑中，轮询刷新不要覆盖
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
        const regs = (t.registrations || []).map(fmtReg);
        const secretOk = !!this.getStoredSecret() || !!t.myReg;
        const myReg = t.myReg ? fmtReg(t.myReg) : null;
        this.setData({
          t,
          myReg,
          isAdmin: !!t.isAdmin,
          loading: false,
          captainList: regs.filter((r) => r.role === 'captain'),
          playerList: regs.filter((r) => r.role === 'player'),
          waitlistList: regs.filter((r) => r.role === 'waitlist'),
          secretOk,
          // 正在编辑队名时保留输入框内容，不被轮询刷新覆盖；否则（队长）用云端已保存的队名初始化
          teamNameInput: this.data.teamNameDirty || !(myReg && myReg.role === 'captain') ? this.data.teamNameInput : myReg.teamName || '',
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
      .then((d) => {
        wx.showToast({
          title: d.auto ? '队员已满，已加入替补' : d.role === 'captain' ? '队长报名成功' : d.role === 'waitlist' ? '替补报名成功' : '报名成功',
          icon: 'success',
        });
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

  /* 管理员：队员 <-> 替补 双向移动 */
  onMoveReg(e) {
    const t = this.data.t;
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    const to = e.currentTarget.dataset.to;
    if (!t) return;
    const actionText = to === 'player' ? '移回队员名单' : '移入替补';
    wx.showModal({
      title: actionText,
      content: '确定将 ' + nickname + ' ' + actionText + '吗？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('moveRegistration', { id: t.id, openid, toRole: to })
            .then(() => {
              wx.showToast({ title: '已调整', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* 队长：设置队伍名称 */
  onTeamNameInput(e) {
    this.setData({ teamNameInput: e.detail.value, teamNameDirty: true });
  },

  onSaveTeamName() {
    const t = this.data.t;
    if (!t) return;
    if (this.data.teamNameSaving) return;
    const teamName = (this.data.teamNameInput || '').trim();
    if (teamName.length > 10) {
      wx.showToast({ title: '队伍名称最多 10 个字', icon: 'none' });
      return;
    }
    this.setData({ teamNameSaving: true });
    api
      .call('setTeamName', { id: t.id, teamName })
      .then(() => {
        wx.showToast({ title: teamName ? '队名已保存' : '已清除队名', icon: 'success' });
        this.setData({ teamNameSaving: false, teamNameInput: teamName, teamNameDirty: false });
        this.load();
      })
      .catch((err) => {
        this.setData({ teamNameSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
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
              this.stopPoll();
              // 立即切换到选人页，无需退出重进
              setTimeout(() => wx.redirectTo({ url: '/pages/draft/draft?id=' + t.id }), 600);
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
