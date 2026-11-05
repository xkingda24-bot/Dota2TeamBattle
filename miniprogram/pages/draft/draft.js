// pages/draft/draft.js - 队长选人（蛇形，按比赛 id）
const api = require('../../utils/api');
const tournamentPolling = require('../../utils/tournament-polling');
const { getTodayBoundary } = require('../../utils/date-time');
const { promptBracketType } = require('../../utils/bracket-format');

const ROLE_LABELS = ['', '1号位', '2号位', '3号位', '4号位', '5号位'];

function fmtRoles(roles) {
  const arr = Array.isArray(roles) ? roles.filter((v) => v >= 1 && v <= 5) : [];
  return arr.length ? arr.map((v) => ROLE_LABELS[v]).join('/') : '';
}

function fmtPlayer(r, isCaptain) {
  return Object.assign({}, r, {
    isCaptain: !!isCaptain,
    mmrText: r.mmr === null || r.mmr === undefined || r.mmr === '' ? '' : '天梯 ' + r.mmr,
    rolesText: fmtRoles(r.roles),
  });
}

Page({
  data: {
    loading: true,
    loadError: '',
    refreshError: false,
    t: null,
    readonly: false,
    stageView: '',
    canManage: false,
    orderChips: [],
    canPick: false,
    pickStateText: '',
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    const stageView = options && options.stage === 'draft' ? 'draft' : '';
    this.setData({ readonly: !!(options && options.readonly === '1'), stageView });
  },

  onShow() {
    tournamentPolling.refreshIfChanged(this);
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
    tournamentPolling.start(this);
  },
  stopPoll() {
    tournamentPolling.stop(this);
  },

  redirectToBattle(tournament) {
    if (this.data.readonly || this._battleRedirecting || !tournament || tournament.status !== 'battle') return;
    this._battleRedirecting = true;
    this.stopPoll();
    const id = encodeURIComponent(tournament.id || this.id || '');
    wx.redirectTo({
      url: '/pages/bracket/bracket?id=' + id + '&view=battle',
      fail: () => {
        this._battleRedirecting = false;
        this.startPoll();
      },
    });
  },

  load(silent) {
    const hadData = !!this.data.t;
    if (!silent && !hadData) this.setData({ loading: true, loadError: '' });
    const data = this.id ? { id: this.id } : {};
    const now = new Date();
    data.todayStart = getTodayBoundary(now);
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
              Object.assign({}, pick, {
                captain: pick.captain ? fmtPlayer(pick.captain, true) : null,
                players: (pick.players || []).map((player) => fmtPlayer(player, false)),
              })
            );
          }
        }
        this._lastTournamentVersion = tournamentPolling.versionToken(t);
        this._lastFullSyncAt = Date.now();
        this.setData({ t, canManage: !!t.canManage && !this.data.readonly, loading: false, loadError: '', refreshError: false }, () => {
          this.redirectToBattle(t);
        });
        this.computeDraft();
      })
      .catch((e) => {
        const hasData = !!this.data.t;
        this.setData({
          loading: false,
          loadError: hasData ? '' : (e.message || '加载比赛失败，请重试'),
          refreshError: hasData,
        });
        if (!silent && !hasData) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  retryLoad() {
    this.load();
  },

  // 计算本轮选人顺序条与"是否轮到我"
  computeDraft() {
    const t = this.data.t;
    if (!t || this.data.readonly || !t.draftInfo) return;
    const di = t.draftInfo;
    let orderChips = [];
    let canPick = false;
    let pickStateText = '';
    if (di.done) {
      pickStateText = '选人完成，等待比赛管理者生成对阵';
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
    if (!t || this.data.readonly || !t.draftInfo) return;
    const di = t.draftInfo;
    if (di.done) return;
    if (!this.data.canPick && !this.data.canManage) {
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
    if (this.data.canManage && !this.data.canPick) {
      const cap = di.currentCaptain ? di.currentCaptain.nickname : '';
      wx.showModal({
        title: '比赛管理者代选',
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
    if (!t || this.data.readonly || !this.data.canManage) return;
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
    if (!t || this.data.readonly || !this.data.canManage || !t.draftInfo) return;
    if (!t.draftInfo.done) {
      wx.showToast({ title: '选人还未完成', icon: 'none' });
      return;
    }
    // 先生成前选赛制：双败（TI）或单败；生成后赛制固定，改动只能退回分组重新生成
    promptBracketType((bracketType) => {
      api
        .call('startBracket', { id: t.id, bracketType })
        .then(() => {
          wx.showToast({ title: '对阵已生成', icon: 'success' });
          setTimeout(() => wx.redirectTo({ url: '/pages/bracket/bracket?id=' + t.id }), 600);
        })
        .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
    });
  },

  onOpenStageManagement() {
    if (!this.id || this.data.readonly || !this.data.canManage) return;
    wx.navigateTo({ url: '/pages/bracket/bracket?id=' + this.id });
  },

  onDelete() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canDelete) return;
    wx.showModal({
      title: '确认删除？',
      content: '（删除后无法恢复。）',
      confirmText: '删除比赛',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: t.id })
            .then(() => {
              wx.showToast({ title: '比赛已删除', icon: 'success' });
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
