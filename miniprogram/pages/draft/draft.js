// pages/draft/draft.js - 队长选人（蛇形，按比赛 id）
const api = require('../../utils/api');
const tournamentPolling = require('../../utils/tournament-polling');
const { getTodayBoundary } = require('../../utils/date-time');

const { formatRolesText } = require('../../utils/roles');
const { BRACKET_TYPES } = require('../../utils/bracket-format');

function fmtRoles(roles) {
  return formatRolesText(roles, '/');
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
    bracketTypeVisible: false,
    bracketTypeSaving: false,
    waitlistPlayers: [],
    waitlistRemoving: '',
    waitlistJoining: false,
    waitlistPanelVisible: false,
    rosterEditable: false,
    rosterSaving: false,
    rosterSelection: { teamIndex: -1, openid: '', nickname: '' },
    substitution: { show: false, teamIndex: -1, outOpenid: '', outNickname: '', candidates: [] },
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    const stageView = options && options.stage === 'draft' ? 'draft' : '';
    this.setData({ readonly: !!(options && options.readonly === '1'), stageView });
  },

  // 转发给好友：带上比赛 id，接收方进入同一场选人
  onShareAppMessage() {
    const id = this.id || '';
    const t = this.data.t || {};
    return {
      title: (t.name || '刀塔集结') + ' · 选人',
      path: '/pages/draft/draft' + (id ? '?id=' + encodeURIComponent(id) : ''),
    };
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
            di.remainingPlayers = di.remainingPlayers.map((player) => fmtPlayer(player, false));
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
        // 选人页替补席：分组阶段仍可继续收替补，管理者可把人移出替补席
        const cardStyles = t.cardStyles || {};
        const waitlistPlayers = (t.registrations || [])
          .filter((registration) => registration && registration.role === 'waitlist')
          .map((registration) => fmtPlayer(Object.assign({}, registration, {
            cardStyle: registration.cardStyle || cardStyles[registration.openid] || null,
          })));
        this.setData({
          t,
          waitlistPlayers,
          canManage: !!t.canManage && !this.data.readonly,
          // 选人完成后可原地交换 / 替换队员（与系统分组页交互一致），无需跳转其他页面
          rosterEditable: !!(t.canManage && !this.data.readonly && t.status === 'draft' &&
            t.draftInfo && t.draftInfo.done),
          loading: false,
          loadError: '',
          refreshError: false,
        }, () => {
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

  // 选人页替补席：比赛管理者把某个替补移出替补席（房主 / 超管 / 普通管理员）
  onOpenWaitlistPanel() {
    this.setData({ waitlistPanelVisible: true });
  },

  onCloseWaitlistPanel() {
    this.setData({ waitlistPanelVisible: false });
  },

  // 弹窗内点空白不穿透
  noopStop() {},

  // 选人页替补席：点名片处理——自己的名片是取消报名，管理者点别人的名片是移出替补
  onTapWaitlistMember(e) {
    const t = this.data.t;
    if (!t || this.data.readonly || this.data.waitlistRemoving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    if (!openid) return;
    const myOpenid = t.myOpenid || (t.myReg && t.myReg.openid) || '';
    if (myOpenid && openid === myOpenid) {
      this.confirmCancelWaitlist();
      return;
    }
    if (!this.data.canManage) {
      wx.showToast({ title: '只有比赛创建者或管理员可以移出替补', icon: 'none' });
      return;
    }
    const nickname = String(e.currentTarget.dataset.nickname || '该替补');
    this.setData({ waitlistRemoving: openid });
    wx.showModal({
      title: '移出替补席',
      content: '确定把「' + nickname + '」移出替补席吗？移出后替补席位空出，其他人仍可报名替补。',
      confirmText: '移除',
      confirmColor: '#d1543f',
      success: (res) => {
        if (!res.confirm) {
          this.setData({ waitlistRemoving: '' });
          return;
        }
        api.call('removeWaitlistRegistration', { id: t.id || this.id, openid })
          .then(() => {
            wx.showToast({ title: '已移出替补席', icon: 'success' });
            this.load(true);
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '移出失败', icon: 'none' });
          })
          .then(() => this.setData({ waitlistRemoving: '' }));
      },
    });
  },

  // 自己的替补报名可以自己取消（首发/队长仍锁定）
  confirmCancelWaitlist() {
    const t = this.data.t;
    if (!t || this.data.readonly) return;
    wx.showModal({
      title: '取消报名',
      content: '确定取消自己的替补报名吗？取消后替补席位空出，之后仍可重新报名。',
      confirmText: '取消报名',
      confirmColor: '#d1543f',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ waitlistRemoving: 'self' });
        api.call('cancelRegister', { id: t.id || this.id })
          .then(() => {
            wx.showToast({ title: '已取消替补报名', icon: 'success' });
            this.load(true);
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '取消失败', icon: 'none' });
          })
          .then(() => this.setData({ waitlistRemoving: '' }));
      },
    });
  },

  // 分组页替补席：不跳页，直接在这里输入暗号报名替补
  onJoinWaitlist() {
    const t = this.data.t;
    if (!t || this.data.readonly || this.data.waitlistJoining) return;
    if (t.myReg) {
      wx.showToast({ title: '你已经在名单里了', icon: 'none' });
      return;
    }
    const id = t.id || this.id || '';
    if (!id) return;
    const left = Math.max(0, (Number(t.waitLimit) || 0) - (this.data.waitlistPlayers || []).length);
    if (left <= 0) {
      wx.showToast({ title: '替补席位已满', icon: 'none' });
      return;
    }
    // 分组阶段报名替补不需要暗号（后端同口径免校验），点按钮直接报名
    const stored = wx.getStorageSync('dota2_secret_' + id) || '';
    const tip = '替补席位还有 ' + left + ' 个空位，报名后进入替补席。';
    if (t.canManage) {
      wx.showModal({
        title: '报名替补',
        content: tip,
        confirmText: '报名',
        success: (res) => {
          if (res.confirm) this.submitWaitlist(id, '');
        },
      });
      return;
    }
    this.submitWaitlist(id, stored);
  },

  submitWaitlist(id, secret) {
    if (!id || this.data.waitlistJoining) return;
    this.setData({ waitlistJoining: true });
    api.call('register', { id, role: 'waitlist', secret })
      .then(() => {
        if (secret) wx.setStorageSync('dota2_secret_' + id, secret);
        wx.showToast({ title: '已加入替补席', icon: 'success' });
        this.load(true);
      })
      .catch((err) => {
        const message = (err && err.message) || '报名失败';
        if (message === '报名暗号错误') {
          try { wx.removeStorageSync('dota2_secret_' + id); } catch (e) { /* 忽略存储异常 */ }
        }
        if (/请先设置昵称|请先在「我的-编辑资料」/.test(message)) {
          wx.showModal({
            title: '报名前先补资料',
            content: message + '。去「我的 - 编辑资料」补全后再来报名。',
            showCancel: false,
            confirmText: '知道了',
          });
          return;
        }
        wx.showToast({ title: message, icon: 'none' });
      })
      .then(() => this.setData({ waitlistJoining: false }));
  },

  onResetDraft() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage) return;
    wx.showModal({
      title: '重置选人',
      content: '将按最新天梯分从低到高重新排序队长（未填写天梯分的排最后）并清空所有已选队员，确定重置？',
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
    if (!t || this.data.readonly || !this.data.canManage || !t.draftInfo || this.data.bracketTypeSaving) return;
    if (!t.draftInfo.done) {
      wx.showToast({ title: '选人还未完成', icon: 'none' });
      return;
    }
    // 先生成前选赛制：双败（TI）或单败；生成后赛制固定，改动只能退回分组重新生成
    this.setData({ bracketTypeVisible: true });
  },

  onCloseBracketType() {
    this.setData({ bracketTypeVisible: false });
  },

  onConfirmBracketType(e) {
    const t = this.data.t;
    const bracketType = e && e.detail ? e.detail.bracketType : '';
    if (!t || BRACKET_TYPES.indexOf(bracketType) < 0) return;
    if (this.data.readonly || !this.data.canManage || this.data.bracketTypeSaving) return;
    this.setData({ bracketTypeVisible: false, bracketTypeSaving: true });
    api
      .call('startBracket', { id: t.id, bracketType })
      .then(() => {
        this.setData({ bracketTypeSaving: false });
        wx.showToast({ title: '对阵已生成', icon: 'success' });
        setTimeout(() => wx.redirectTo({ url: '/pages/bracket/bracket?id=' + t.id }), 600);
      })
      .catch((err) => {
        this.setData({ bracketTypeSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  /* ---------- 选人完成后：队伍名单内直接交换 / 替换（与系统分组页交互一致） ---------- */

  onTapRosterMember(e) {
    if (!this.data.rosterEditable || !this.data.canManage || this.data.readonly || this.data.rosterSaving) return;
    const teamIndex = Number(e.currentTarget.dataset.teamIndex);
    const openid = String(e.currentTarget.dataset.openid || '');
    if (!openid) return;
    const isCaptain = e.currentTarget.dataset.isCaptain === true || e.currentTarget.dataset.isCaptain === 'true';
    if (isCaptain) {
      wx.showToast({ title: '队长不参与交换', icon: 'none' });
      return;
    }
    const selection = this.data.rosterSelection;
    if (selection.openid && selection.teamIndex !== teamIndex) {
      this.swapRosterMembers(selection.teamIndex, selection.openid, teamIndex, openid);
      return;
    }
    if (selection.openid === openid) {
      this.clearRosterSelection();
      return;
    }
    if (selection.openid) {
      wx.showToast({ title: '请选择其他队的队员完成交换', icon: 'none' });
      return;
    }
    const team = ((this.data.t && this.data.t.draftInfo && this.data.t.draftInfo.picks) || [])
      .find((pick) => pick.teamIndex === teamIndex);
    const member = team && (team.players || []).find((player) => player.openid === openid);
    const nickname = member ? member.nickname : '队员';
    this.setData({ rosterSelection: { teamIndex, openid, nickname } });
    wx.showToast({ title: '已选择 ' + nickname + '，再点其他队队员交换', icon: 'none' });
  },

  clearRosterSelection() {
    this.setData({ rosterSelection: { teamIndex: -1, openid: '', nickname: '' } });
  },

  swapRosterMembers(teamAIndex, openidA, teamBIndex, openidB) {
    const t = this.data.t;
    if (!t || this.data.rosterSaving) return;
    this.setData({ rosterSaving: true });
    api.call('swapPlayers', { id: t.id, teamAIndex, openidA, teamBIndex, openidB })
      .then(() => {
        wx.showToast({ title: '队员已交换', icon: 'success' });
        this.setData({ rosterSaving: false, rosterSelection: { teamIndex: -1, openid: '', nickname: '' } });
        this.load(true);
      })
      .catch((error) => {
        this.setData({ rosterSaving: false });
        wx.showToast({ title: error.message || '交换队员失败', icon: 'none' });
        this.load(true);
      });
  },

  onOpenSubstitution(e) {
    if (!this.data.rosterEditable || !this.data.canManage || this.data.readonly || this.data.rosterSaving) return;
    const teamIndex = Number(e.currentTarget.dataset.teamIndex);
    const outOpenid = String(e.currentTarget.dataset.openid || '');
    if (!Number.isInteger(teamIndex) || !outOpenid) return;
    const di = (this.data.t && this.data.t.draftInfo) || {};
    const team = (di.picks || []).find((pick) => pick.teamIndex === teamIndex);
    const captain = team && team.captain;
    const isCaptainOut = !!captain && captain.openid === outOpenid;
    // 队长只能由替补替换，普通队员可从未选队员池或替补席换人
    const candidates = (isCaptainOut
      ? (this.data.waitlistPlayers || [])
      : ((di.remainingPlayers || []).map((player) => Object.assign({}, player, { role: 'player' }))
        .concat(this.data.waitlistPlayers || [])))
      .filter((player) => player && player.openid && player.openid !== outOpenid);
    const member = isCaptainOut ? captain : (team && (team.players || []).find((player) => player.openid === outOpenid));
    this.setData({
      rosterSelection: { teamIndex: -1, openid: '', nickname: '' },
      substitution: {
        show: true,
        teamIndex,
        outOpenid,
        outNickname: member ? member.nickname : '队员',
        outIsCaptain: isCaptainOut,
        candidates,
      },
    });
  },

  onCloseSubstitution() {
    if (this.data.rosterSaving) return;
    this.setData({ substitution: { show: false, teamIndex: -1, outOpenid: '', outNickname: '', candidates: [] } });
  },

  onPickSubstitute(e) {
    const t = this.data.t;
    const panel = this.data.substitution;
    const inOpenid = String(e.currentTarget.dataset.openid || '');
    if (!t || !panel.show || !inOpenid || this.data.rosterSaving) return;
    wx.showModal({
      title: panel.outIsCaptain ? '确认替换队长' : '确认替换队员',
      content: panel.outIsCaptain
        ? '用该队员接任队长，原队长 ' + panel.outNickname + ' 进入替补席，确定继续？'
        : '用该队员换下 ' + panel.outNickname + '？',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ rosterSaving: true });
        api.call('replacePlayer', { id: t.id, teamIndex: panel.teamIndex, outOpenid: panel.outOpenid, inOpenid })
          .then(() => {
            wx.showToast({ title: panel.outIsCaptain ? '队长已替换' : '队员已替换', icon: 'success' });
            this.setData({
              rosterSaving: false,
              substitution: { show: false, teamIndex: -1, outOpenid: '', outNickname: '', candidates: [] },
            });
            this.load(true);
          })
          .catch((error) => {
            this.setData({ rosterSaving: false });
            wx.showToast({ title: error.message || '替换队员失败', icon: 'none' });
            this.load(true);
          });
      },
    });
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
