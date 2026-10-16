// pages/index/index.js - 主页（创建比赛 + 今天的比赛 + 历史入口）
const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    user: null,
    isAdmin: false,
    isSuper: false,
    hasSuper: false,
    today: [],
    // 暗号验证弹窗
    secretModal: false,
    secretTargetId: '',
    secretTargetName: '',
    secretInput: '',
    secretChecking: false,
    // 昵称设置弹窗
    nickModal: false,
    nickInput: '',
    nickSaving: false,
    pfMmr: '',
    pfRoles: [],
    rolesActive: [false, false, false, false, false],
    pfSig: '',
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return api
      .call('home', { todayStart })
      .then((d) => {
        const today = (d.today || []).map((item) =>
          Object.assign({}, item, {
            phaseText:
              item.status === 'registration'
                ? '报名中'
                : item.status === 'draft'
                ? '选人中'
                : item.status === 'battle'
                ? '对战中'
                : '已结束',
            swipeX: 0, // 左滑偏移（px），露出归档/删除按钮
            swipeOpen: false,
          })
        );
        this.setData({
          user: d.user,
          isAdmin: !!d.isAdmin,
          isSuper: !!d.isSuper,
          hasSuper: !!d.hasSuper,
          today,
          loading: false,
        });
        // 登录后未设置昵称 → 自动弹窗
        if (!d.user && !this._nickPrompted) {
          this._nickPrompted = true;
          setTimeout(
            () =>
              this.setData({
                nickModal: true,
                nickInput: '',
                pfMmr: '',
                pfRoles: [],
                rolesActive: [false, false, false, false, false],
                pfSig: '',
              }),
            300
          );
        }
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value });
  },

  onPfMmr(e) {
    this.setData({ pfMmr: e.detail.value });
  },

  onPfSig(e) {
    this.setData({ pfSig: e.detail.value });
  },

  onToggleRole(e) {
    const v = Number(e.currentTarget.dataset.role);
    const roles = this.data.pfRoles.slice();
    const rolesActive = this.data.rolesActive.slice();
    const i = roles.indexOf(v);
    if (i >= 0) {
      roles.splice(i, 1);
      rolesActive[v - 1] = false;
    } else {
      roles.push(v);
      rolesActive[v - 1] = true;
    }
    this.setData({ pfRoles: roles.sort((a, b) => a - b), rolesActive });
  },

  onConfirmNick() {
    if (this.data.nickSaving) return;
    const nickname = this.data.nickInput.trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (nickname.length > 20) {
      wx.showToast({ title: '昵称最多 20 个字', icon: 'none' });
      return;
    }
    const sig = (this.data.pfSig || '').trim();
    if (sig.length > 15) {
      wx.showToast({ title: '个人签名最多 15 个字', icon: 'none' });
      return;
    }
    let mmr = '';
    if ((this.data.pfMmr || '').trim() !== '') {
      mmr = Number(this.data.pfMmr);
      if (!isFinite(mmr) || mmr < 0 || mmr > 20000) {
        wx.showToast({ title: '天梯分需在 0-20000 之间', icon: 'none' });
        return;
      }
      mmr = Math.round(mmr);
    }
    this.setData({ nickSaving: true });
    api
      .call('saveProfile', { nickname, mmr, roles: this.data.pfRoles, signature: sig })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({
          nickModal: false,
          nickInput: '',
          nickSaving: false,
          pfMmr: '',
          pfRoles: [],
          rolesActive: [false, false, false, false, false],
          pfSig: '',
        });
        this.load();
      })
      .catch((err) => {
        this.setData({ nickSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onCloseNick() {
    if (this.data.nickSaving) return;
    this.setData({
      nickModal: false,
      nickInput: '',
      pfMmr: '',
      pfRoles: [],
      rolesActive: [false, false, false, false, false],
      pfSig: '',
    });
  },

  goCreate() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '只有管理员可以创建比赛', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },

  goTournament(e) {
    // 刚完成滑动操作时忽略本次点击（避免滑完误触进入）
    if (this._swipeMoved) {
      this._swipeMoved = false;
      return;
    }
    const item = this.data.today[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.status === 'registration') {
      // 已报名或本机已通过暗号 → 直接进入；否则弹窗验证暗号
      if (item.meRegistered || wx.getStorageSync('dota2_secret_' + item.id)) {
        wx.navigateTo({ url: '/pages/register/register?id=' + item.id });
        return;
      }
      this.setData({
        secretModal: true,
        secretTargetId: item.id,
        secretTargetName: item.name,
        secretInput: '',
        secretChecking: false,
      });
    } else if (item.status === 'draft') {
      wx.navigateTo({ url: '/pages/draft/draft?id=' + item.id });
    } else {
      wx.navigateTo({ url: '/pages/bracket/bracket?id=' + item.id });
    }
  },

  onLongPressTournament(e) {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '只有管理员可以删除', icon: 'none' });
      return;
    }
    const item = this.data.today[e.currentTarget.dataset.index];
    if (!item) return;
    wx.showModal({
      title: '删除比赛',
      content: '将永久删除「' + item.name + '」的全部数据（报名/选人/赛程），不可恢复！确定删除？',
      confirmText: '删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: item.id })
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* ---------- 左滑卡片：归档 / 删除（管理员） ---------- */
  onSwipeStart(e) {
    if (!this.data.isAdmin) return;
    this._swipeStartX = e.touches[0].clientX;
    this._swipeIndex = e.currentTarget.dataset.index;
    this._swipeMoved = false;
  },

  onSwipeMove(e) {
    const index = this._swipeIndex;
    if (index == null) return;
    const dx = e.touches[0].clientX - this._swipeStartX;
    const wasOpen = this.data.today[index] && this.data.today[index].swipeOpen;
    const base = wasOpen ? -140 : 0;
    let x = base + dx;
    if (x > 0) x = 0;
    if (x < -140) x = -140;
    if (Math.abs(dx) > 8) this._swipeMoved = true;
    this.setData({ ['today[' + index + '].swipeX']: x });
  },

  onSwipeEnd() {
    const index = this._swipeIndex;
    if (index == null) return;
    const x = this.data.today[index] ? this.data.today[index].swipeX : 0;
    const open = x < -70;
    const patches = {
      ['today[' + index + '].swipeX']: open ? -140 : 0,
      ['today[' + index + '].swipeOpen']: open,
    };
    this.data.today.forEach((it, i) => {
      if (i !== index && it.swipeOpen) {
        patches['today[' + i + '].swipeX'] = 0;
        patches['today[' + i + '].swipeOpen'] = false;
      }
    });
    this.setData(patches);
    this._swipeIndex = null;
  },

  onSwipeAction(e) {
    const index = Number(e.currentTarget.dataset.index);
    const action = e.currentTarget.dataset.action;
    const item = this.data.today[index];
    if (!item || !this.data.isAdmin) return;
    // 先收起卡片
    this.setData({ ['today[' + index + '].swipeX']: 0, ['today[' + index + '].swipeOpen']: false });
    if (action === 'archive') {
      wx.showModal({
        title: '归档比赛',
        content: '将「' + item.name + '」归档到历史比赛，确定归档？',
        success: (res) => {
          if (res.confirm) {
            api
              .call('finishTournament', { id: item.id })
              .then(() => {
                wx.showToast({ title: '已归档', icon: 'success' });
                this.load();
              })
              .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
          }
        },
      });
    } else if (action === 'delete') {
      wx.showModal({
        title: '删除比赛',
        content: '将永久删除「' + item.name + '」的全部数据（报名/选人/赛程），不可恢复！确定删除？',
        confirmText: '删除',
        confirmColor: '#e5484d',
        success: (res) => {
          if (res.confirm) {
            api
              .call('deleteTournament', { id: item.id })
              .then(() => {
                wx.showToast({ title: '已删除', icon: 'success' });
                this.load();
              })
              .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
          }
        },
      });
    }
  },

  onSecretInput(e) {
    this.setData({ secretInput: e.detail.value });
  },

  onConfirmSecret() {
    const id = this.data.secretTargetId;
    if (!id || this.data.secretChecking) return;
    const secret = this.data.secretInput.trim();
    if (!secret) {
      wx.showToast({ title: '请输入报名暗号', icon: 'none' });
      return;
    }
    this.setData({ secretChecking: true });
    api
      .call('checkSecret', { id, secret })
      .then((d) => {
        if (!d.correct) {
          this.setData({ secretChecking: false });
          wx.showToast({ title: '暗号错误', icon: 'none' });
          return;
        }
        wx.setStorageSync('dota2_secret_' + id, secret);
        this.setData({
          secretModal: false,
          secretChecking: false,
          secretInput: '',
          secretTargetId: '',
          secretTargetName: '',
        });
        wx.navigateTo({ url: '/pages/register/register?id=' + id });
      })
      .catch((err) => {
        this.setData({ secretChecking: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onCloseSecret() {
    if (this.data.secretChecking) return;
    this.setData({ secretModal: false, secretInput: '', secretTargetId: '', secretTargetName: '' });
  },

  noop() {},
});
