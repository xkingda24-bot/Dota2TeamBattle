// pages/create/create.js - 创建比赛 / 赛事配置（id 存在时进入编辑模式）
const api = require('../../utils/api');
const { getTodayBoundary } = require('../../utils/date-time');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

Page({
  data: {
    editMode: false,
    pageLoading: false,
    checkingAccess: false,
    accessCheckFailed: false,
    accessMessage: '',
    isSuper: false,
    todayCreateRemaining: 5,
    todayCreateLimit: 5,
    name: '',
    secret: '',
    date: '',
    time: '',
    nRange: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    nIndex: 6, // 默认 8 个队长
    kRange: [1, 2, 3, 4, 5],
    kIndex: 3, // 默认 每队 4 个队友
    waitRange: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    waitIndex: 10, // 默认 10 个替补
    modeRange: ['队长选人', '系统分组'],
    modeIndex: 0,
    mode: 'captain', // captain=队长选人 auto=系统分组
    N: 8,
    K: 4,
    waitLimit: 10,
    submitting: false,
  },

  onLoad(options) {
    const now = new Date();
    this.setData({
      date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      time: pad(now.getHours()) + ':' + pad(now.getMinutes()),
    });

    // 编辑模式：创建者或最高管理员修改比赛配置
    if (options && options.id) {
      this.id = options.id;
      this.setData({ editMode: true, pageLoading: true });
      this.loadTournament();
      return;
    }

    // 所有用户都可以创建，服务端会校验每日额度
    this.setData({ checkingAccess: true });
    this.checkCreateAccess();
  },

  loadTournament() {
    return api
      .call('tournament', { id: this.id })
      .then((d) => {
        if (!d || !d.canManage) {
          this.setData({
            pageLoading: false,
            accessCheckFailed: true,
            accessMessage: '当前账号没有修改此赛事的权限',
          });
          wx.showModal({
            title: '没有权限',
            content: '只有比赛创建者或最高管理员可以修改比赛配置。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
          return;
        }
        const date = (d.time || '').slice(0, 10);
        const time = (d.time || '').slice(11, 16);
        const nIdx = this.data.nRange.indexOf(d.N);
        const kIdx = this.data.kRange.indexOf(d.K);
        const wLimit = d.waitLimit === undefined || d.waitLimit === null ? 5 : Number(d.waitLimit);
        const wIdx = this.data.waitRange.indexOf(wLimit);
        this.setData({
          name: d.name || '',
          secret: d.secret || '',
          date: date || this.data.date,
          time: time || this.data.time,
          mode: d.mode === 'auto' ? 'auto' : 'captain',
          modeIndex: d.mode === 'auto' ? 1 : 0,
          N: d.N,
          K: d.K,
          waitLimit: wLimit,
          isSuper: !!d.isSuper,
          pageLoading: false,
          waitIndex: wIdx >= 0 ? wIdx : this.data.waitIndex,
          nIndex: nIdx >= 0 ? nIdx : this.data.nIndex,
          kIndex: kIdx >= 0 ? kIdx : this.data.kIndex,
        });
      })
      .catch((e) => {
        this.setData({ pageLoading: false, accessCheckFailed: true, accessMessage: e.message || '比赛信息加载失败' });
      });
  },

  checkCreateAccess() {
    const now = new Date();
    const todayStart = getTodayBoundary(now);
    return api
      .call('home', { todayStart })
      .then((d) => {
        this.setData({
          checkingAccess: false,
          accessCheckFailed: false,
          accessMessage: '',
          isSuper: !!d.isSuper,
          todayCreateRemaining: d.todayCreateRemaining == null ? 5 : Number(d.todayCreateRemaining),
          todayCreateLimit: Number(d.todayCreateLimit || d.dailyLimit) || 5,
        });
      })
      .catch((e) => {
        this.setData({ checkingAccess: false, accessCheckFailed: true, accessMessage: e.message || '创建权限检查失败' });
      });
  },

  retryAccessCheck() {
    this.setData({ accessCheckFailed: false, accessMessage: '' });
    if (this.id) {
      this.setData({ pageLoading: true });
      this.loadTournament();
    } else {
      this.setData({ checkingAccess: true });
      this.checkCreateAccess();
    }
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },
  onSecret(e) {
    this.setData({ secret: e.detail.value });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },
  onMode(e) {
    const i = Number(e.detail.value);
    const patch = { modeIndex: i, mode: i === 1 ? 'auto' : 'captain' };
    // 切到系统分组时默认每组 5 人（K=5）
    if (i === 1 && this.data.K < 5) {
      patch.K = 5;
      patch.kIndex = 4;
    }
    this.setData(patch);
  },
  onN(e) {
    const i = Number(e.detail.value);
    this.setData({ nIndex: i, N: this.data.nRange[i] });
  },
  onK(e) {
    const i = Number(e.detail.value);
    this.setData({ kIndex: i, K: this.data.kRange[i] });
  },
  onWait(e) {
    const i = Number(e.detail.value);
    this.setData({ waitIndex: i, waitLimit: this.data.waitRange[i] });
  },

  submit() {
    if (this.data.submitting || this.data.pageLoading || this.data.checkingAccess || this.data.accessCheckFailed) return;
    if (!this.data.editMode && this.data.todayCreateRemaining <= 0) {
      wx.showToast({ title: '今天创建比赛的次数已用完', icon: 'none' });
      return;
    }
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '请填写比赛名称', icon: 'none' });
      return;
    }
    const secret = this.data.secret.trim();
    if (!secret) {
      wx.showToast({ title: '请设置报名暗号', icon: 'none' });
      return;
    }
    if (secret.length > 20) {
      wx.showToast({ title: '报名暗号最多 20 个字', icon: 'none' });
      return;
    }
    if (!this.data.date || !this.data.time) {
      wx.showToast({ title: '请设置比赛日期和时间', icon: 'none' });
      return;
    }
    const time = this.data.date + ' ' + this.data.time;
    this.setData({ submitting: true });
    const done = (result) => {
      if (!this.data.editMode && result && Number.isFinite(Number(result.todayCreateRemaining))) {
        this.setData({ todayCreateRemaining: Number(result.todayCreateRemaining) });
      }
      wx.showToast({ title: this.data.editMode ? '已保存' : '创建成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    };
    if (this.data.editMode) {
      api
        .call('updateConfig', {
          id: this.id,
          name,
          time,
          secret,
          mode: this.data.mode,
          N: this.data.N,
          K: this.data.K,
          waitLimit: this.data.waitLimit,
        })
        .then(done)
        .catch((e) => {
          this.setData({ submitting: false });
          wx.showToast({ title: e.message, icon: 'none' });
        });
      return;
    }
    api
      .call('createTournament', {
        name,
        time,
        secret,
        mode: this.data.mode,
        N: this.data.N,
        K: this.data.K,
        waitLimit: this.data.waitLimit,
      })
      .then(done)
      .catch((e) => {
        this.setData({ submitting: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },
});
