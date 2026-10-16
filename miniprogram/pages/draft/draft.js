// pages/draft/draft.js - 队长选人（蛇形，按比赛 id）
const api = require('../../utils/api');

const ROLE_LABELS = ['', '1号位', '2号位', '3号位', '4号位', '5号位'];

function fmtRoles(roles) {
  const arr = Array.isArray(roles) ? roles.filter((v) => v >= 1 && v <= 5) : [];
  return arr.length ? arr.map((v) => ROLE_LABELS[v]).join('/') : '';
}

function fmtPlayer(r) {
  return Object.assign({}, r, {
    mmrText: r.mmr ? '天梯 ' + r.mmr : '',
    rolesText: fmtRoles(r.roles),
  });
}

Page({
  data: {
    loading: true,
    t: null,
    isAdmin: false,
    orderChips: [],
    canPick: false,
    pickStateText: '',
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
        const di = t.draftInfo;
        if (di) {
          if (Array.isArray(di.remainingPlayers)) {
            di.remainingPlayers = di.remainingPlayers.map(fmtPlayer);
          }
          if (Array.isArray(di.picks)) {
            di.picks = di.picks.map((pick) =>
              Object.assign({}, pick, { players: (pick.players || []).map(fmtPlayer) })
            );
          }
        }
        this.setData({ t, isAdmin: !!t.isAdmin, loading: false });
        this.computeDraft();
      })
      .catch((e) => {
        this.setData({ loading: false, t: null });
        if (!silent) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  // 计算本轮选人顺序条与"是否轮到我"
  computeDraft() {
    const t = this.data.t;
    if (!t || !t.draftInfo) return;
    const di = t.draftInfo;
    let orderChips = [];
    let canPick = false;
    let pickStateText = '';
    if (di.done) {
      pickStateText = '选人完成，等待管理员生成对阵';
    } else {
      const order = [];
      for (let i = 0; i < t.N; i++) {
        const idx = di.round % 2 === 1 ? i : t.N - 1 - i;
        order.push({
          idx,
          nickname: (di.captainOrder[idx] || {}).nickname || '',
          active: idx === di.capIdx,
        });
      }
      orderChips = order;
      canPick = !!(di.currentCaptain && di.currentCaptain.openid === t.myOpenid);
      pickStateText = '第 ' + di.round + '/' + t.K + ' 轮 · 第 ' + (di.turn + 1) + '/' + di.totalPicks + ' 次选择';
    }
    this.setData({ orderChips, canPick, pickStateText });
  },

  onPick(e) {
    const openid = e.currentTarget.dataset.openid;
    const name = e.currentTarget.dataset.name;
    const t = this.data.t;
    if (!t || !t.draftInfo) return;
    const di = t.draftInfo;
    if (di.done) return;
    if (!this.data.canPick && !this.data.isAdmin) {
      wx.showToast({ title: '还没轮到你选人', icon: 'none' });
      return;
    }
    const doPick = () =>
      api
        .call('pickPlayer', { id: t.id, playerOpenid: openid })
        .then(() => {
          wx.showToast({ title: '已选择：' + name, icon: 'success' });
          this.load();
        })
        .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
    if (this.data.isAdmin && !this.data.canPick) {
      const cap = di.currentCaptain ? di.currentCaptain.nickname : '';
      wx.showModal({
        title: '管理员代选',
        content: '为当前队长（' + cap + '）代选 ' + name + ' ？',
        success: (res) => {
          if (res.confirm) doPick();
        },
      });
    } else {
      wx.showModal({
        title: '确认选择',
        content: '确定选择 ' + name + ' 加入本队？',
        success: (res) => {
          if (res.confirm) doPick();
        },
      });
    }
  },

  onResetDraft() {
    const t = this.data.t;
    if (!t) return;
    wx.showModal({
      title: '重置选人',
      content: '将重新随机排序队长并清空所有已选队员，确定重置？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('resetDraft', { id: t.id })
            .then(() => {
              wx.showToast({ title: '已重置', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onStartBracket() {
    const t = this.data.t;
    if (!t || !t.draftInfo) return;
    if (!t.draftInfo.done) {
      wx.showToast({ title: '选人还未完成', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '生成对阵',
      content: '将按 TI 双败赛制自动生成全部对阵，并进入对战阶段。确定生成？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('startBracket', { id: t.id })
            .then(() => {
              wx.showToast({ title: '对阵已生成', icon: 'success' });
              setTimeout(() => wx.redirectTo({ url: '/pages/bracket/bracket?id=' + t.id }), 600);
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

  goBack() {
    wx.navigateBack();
  },
});
