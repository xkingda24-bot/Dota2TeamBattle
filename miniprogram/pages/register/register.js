// pages/register/register.js - 报名（按比赛 id，需暗号；支持替补与队长队名）
const api = require('../../utils/api');
const tournamentPolling = require('../../utils/tournament-polling');
const { TEAM_LOGO_PRESETS } = require('../../utils/team-logos');
const { getTodayBoundary } = require('../../utils/date-time');

const { formatRolesText } = require('../../utils/roles');

function fmtRoles(roles) {
  return formatRolesText(roles, ' / ');
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
    loadError: '',
    notFound: false,
    refreshError: false,
    regSubmitting: false,
    testFillSubmitting: false,
    t: null,
    readonly: false,
    stageView: '',
    myReg: null,
    canManage: false,
    activeTab: 'captain',
    captainList: [],
    playerList: [],
    waitlistList: [],
    secretInput: '',
    secretOk: false,
    // 队长队名
    teamNameInput: '',
    teamIconInput: '',
    teamLogos: [],
    allTeamLogos: [],
    teamLogoLoadFailed: false,
    showTeamModal: false,
    teamNameSaving: false,
    teamNameDirty: false, // 输入框正在编辑中，轮询刷新不要覆盖
    grouping: false,
    // 比赛管理者点击报名名片弹出的成员操作面板
    memberAction: { show: false, openid: '', nickname: '', role: '' },
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    const stageView = options && options.stage === 'registration' ? 'registration' : '';
    this.setData({ readonly: !!(options && options.readonly === '1'), stageView });
  },

  onShow() {
    this.loadTeamLogos();
    tournamentPolling.refreshIfChanged(this);
    this.startPoll();
  },

  loadTeamLogos() {
    this.setData({
      teamLogos: TEAM_LOGO_PRESETS,
      allTeamLogos: TEAM_LOGO_PRESETS,
      teamLogoLoadFailed: false,
    });
    this.refreshRegistrationIcons(TEAM_LOGO_PRESETS);
  },

  applyRegistrationSnapshot(snapshot) {
    const current = this.data.t || {};
    const registrations = Array.isArray(snapshot && snapshot.registrations) ? snapshot.registrations : [];
    const previousByOpenid = {};
    (current.registrations || []).forEach((registration) => {
      if (registration && registration.openid) previousByOpenid[registration.openid] = registration;
    });
    const emojiById = {};
    TEAM_LOGO_PRESETS.forEach((logo) => (emojiById[logo.id] = logo.emoji));
    const regs = registrations.map((registration) => {
      const merged = Object.assign({}, previousByOpenid[registration.openid] || {}, registration);
      return Object.assign(fmtReg(merged), { teamIconEmoji: emojiById[registration.teamIcon] || '' });
    });
    const myReg = snapshot.myReg
      ? Object.assign(fmtReg(Object.assign({}, previousByOpenid[snapshot.myReg.openid] || {}, snapshot.myReg)), {
          teamIconEmoji: emojiById[snapshot.myReg.teamIcon] || '',
        })
      : null;
    const t = Object.assign({}, current, snapshot, { id: snapshot.id || current.id });
    const activeTab = t.mode === 'auto' && this.data.activeTab === 'captain' ? 'player' : this.data.activeTab;
    this.setData({
      t,
      myReg,
      activeTab,
      captainList: regs.filter((r) => r.role === 'captain'),
      playerList: regs.filter((r) => r.role === 'player'),
      waitlistList: regs.filter((r) => r.role === 'waitlist'),
      teamNameInput: this.data.teamNameDirty || !(myReg && myReg.role === 'captain') ? this.data.teamNameInput : myReg.teamName || '',
      teamIconInput: this.data.teamNameDirty || !(myReg && myReg.role === 'captain') ? this.data.teamIconInput : myReg.teamIcon || '',
    });
  },

  refreshTournamentSnapshot(version) {
    if (!this.id) return this.load(true);
    return api.call('tournamentRegistrationSnapshot', { id: this.id }).then((snapshot) => {
      const previous = this.data.t;
      if (!snapshot || !previous || snapshot.status !== previous.status || snapshot.status !== 'registration') {
        return this.load(true);
      }
      this.applyRegistrationSnapshot(snapshot);
      this._lastTournamentVersion = tournamentPolling.versionToken(version || snapshot);
    });
  },

  refreshRegistrationIcons(logos) {
    if (!this.data.t) return;
    const emojiById = {};
    (logos || []).forEach((logo) => (emojiById[logo.id] = logo.emoji));
    const addIcon = (registration) => Object.assign({}, registration, {
      teamIconEmoji: emojiById[registration.teamIcon] || '',
    });
    this.setData({
      myReg: this.data.myReg ? addIcon(this.data.myReg) : null,
      captainList: (this.data.captainList || []).map(addIcon),
      playerList: (this.data.playerList || []).map(addIcon),
      waitlistList: (this.data.waitlistList || []).map(addIcon),
    });
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

  redirectToTournamentStage(tournament) {
    if (
      this.data.readonly ||
      this._stageRedirecting ||
      !tournament
    ) return;

    let url = '';
    if (tournament.mode === 'auto' && tournament.status === 'draft') {
      url = '/pages/bracket/bracket?id=' + encodeURIComponent(tournament.id || this.id || '') + '&view=draft';
    } else if (tournament.status === 'battle') {
      url = '/pages/bracket/bracket?id=' + encodeURIComponent(tournament.id || this.id || '') + '&view=battle';
    }
    if (!url) return;

    this._stageRedirecting = true;
    this.stopPoll();
    wx.redirectTo({
      url,
      fail: () => {
        this._stageRedirecting = false;
        this.startPoll();
      },
    });
  },

  load(silent) {
    const hadData = !!this.data.t;
    if (!silent && !hadData) {
      this.setData({ loading: true, loadError: '', notFound: false, refreshError: false });
    } else if (!silent) {
      this.setData({ refreshError: false });
    }
    const data = this.id ? { id: this.id } : {};
    const now = new Date();
    data.todayStart = getTodayBoundary(now);
    const action = this.id && !this.data.readonly ? 'registrationDetail' : 'tournament';
    return api
      .call(action, data)
      .then((t) => {
        if (!t) {
          this.setData(hadData
            ? { loading: false, refreshError: true }
            : { loading: false, t: null, notFound: true, loadError: '', refreshError: false });
          return;
        }
        const emojiById = {};
        (this.data.allTeamLogos || []).forEach((logo) => (emojiById[logo.id] = logo.emoji));
        const regs = (t.registrations || []).map((registration) => Object.assign(fmtReg(registration), {
          teamIconEmoji: emojiById[registration.teamIcon] || '',
        }));
        const secretOk = !!t.canManage || !!this.getStoredSecret() || !!t.myReg;
        const myReg = t.myReg ? Object.assign(fmtReg(t.myReg), { teamIconEmoji: emojiById[t.myReg.teamIcon] || '' }) : null;
        const activeTab = t.mode === 'auto' && this.data.activeTab === 'captain' ? 'player' : this.data.activeTab;
        this._lastTournamentVersion = tournamentPolling.versionToken(t);
        this._lastFullSyncAt = Date.now();
        this.setData({
          t,
          myReg,
          activeTab,
          canManage: !!t.canManage && !this.data.readonly,
          loading: false,
          loadError: '',
          notFound: false,
          refreshError: false,
          captainList: regs.filter((r) => r.role === 'captain'),
          playerList: regs.filter((r) => r.role === 'player'),
          waitlistList: regs.filter((r) => r.role === 'waitlist'),
          secretOk,
          // 正在编辑队名时保留输入框内容，不被轮询刷新覆盖；否则（队长）用云端已保存的队名初始化
          teamNameInput: this.data.teamNameDirty || !(myReg && myReg.role === 'captain') ? this.data.teamNameInput : myReg.teamName || '',
          teamIconInput: this.data.teamNameDirty || !(myReg && myReg.role === 'captain') ? this.data.teamIconInput : myReg.teamIcon || '',
        }, () => this.redirectToTournamentStage(t));
      })
      .catch((e) => {
        const hasData = !!this.data.t;
        const notFound = !hasData && e.message === '比赛不存在';
        this.setData({
          loading: false,
          loadError: hasData || notFound ? '' : (e.message || '比赛加载失败，请重试'),
          notFound,
          refreshError: hasData,
        });
      });
  },

  retryLoad() {
    this.load();
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
    if (!t || this.data.readonly || t.status !== 'registration' || this.data.myReg) return;
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
    const t = this.data.t;
    if (!t || this.data.readonly || this.data.regSubmitting) return;
    if (['captain', 'player', 'waitlist'].indexOf(role) < 0) return;
    if (t.status !== 'registration') {
      wx.showToast({ title: '当前不在报名阶段', icon: 'none' });
      return;
    }
    if (this.data.myReg) {
      wx.showToast({ title: '你已经报名了', icon: 'none' });
      return;
    }
    if (role === 'captain' && (t.mode === 'auto' || t.captainFilled >= t.captainTotal)) {
      wx.showToast({ title: t.mode === 'auto' ? '本场比赛为系统分组模式' : '队长名额已满', icon: 'none' });
      return;
    }
    if (role === 'waitlist' && (t.waitLimit <= 0 || t.waitlistFilled >= t.waitLimit)) {
      wx.showToast({ title: t.waitLimit <= 0 ? '本场比赛未设置替补' : '替补名额已满', icon: 'none' });
      return;
    }
    if (role === 'player' && t.playerFilled >= t.playerTotal && (t.waitLimit <= 0 || t.waitlistFilled >= t.waitLimit)) {
      wx.showToast({ title: t.waitLimit <= 0 ? '队员名额已满' : '队员与替补名额已满', icon: 'none' });
      return;
    }
    const secret = this.getStoredSecret();
    this.setData({ regSubmitting: true });
    api
      .call('register', { id: t.id, role, secret })
      .then((d) => {
        wx.showToast({
          title: d.auto ? '队员已满，已加入替补' : d.role === 'captain' ? '队长报名成功' : d.role === 'waitlist' ? '替补报名成功' : '报名成功',
          icon: 'success',
        });
        const current = this.data.t || {};
        const registration = d && d.registration;
        if (registration && current.id === t.id) {
          const registrations = (current.registrations || []).filter((item) => item.openid !== registration.openid).concat([registration]);
          this.applyRegistrationSnapshot(Object.assign({}, d, {
            id: t.id,
            status: current.status,
            mode: current.mode,
            N: current.N,
            K: current.K,
            waitLimit: current.waitLimit,
            registrations,
            myReg: registration,
          }));
          this._lastTournamentVersion = tournamentPolling.versionToken(this.data.t);
        } else {
          return this.load(true);
        }
      })
      .catch((err) => {
        if (err.message === '报名暗号错误') {
          this.clearStoredSecret();
          this.setData({ secretOk: false, secretInput: '' });
          wx.showToast({ title: '报名暗号已变更，请重新验证', icon: 'none' });
          return;
        }
        if (/请先设置昵称|请先在「我的-编辑资料」/.test(err.message || '')) {
          wx.showModal({
            title: '先完善个人资料',
            content: '报名需要昵称、天梯分和常玩位置。现在去「我的」完善资料吗？',
            confirmText: '去完善',
            success: (res) => {
              if (res.confirm) wx.navigateTo({ url: '/pages/staff/staff' });
            },
          });
          return;
        }
        wx.showToast({ title: err.message, icon: 'none' });
      })
      .finally(() => {
        this.setData({ regSubmitting: false });
      });
  },

  clearStoredSecret() {
    if (this.id) wx.removeStorageSync('dota2_secret_' + this.id);
  },

  onReenterSecret() {
    this.clearStoredSecret();
    this.setData({ secretOk: false, secretInput: '' });
    wx.showToast({ title: '请输入最新报名暗号', icon: 'none' });
  },

  /* 创建者或管理员：复制本场报名暗号 */
  onCopySecret() {
    const t = this.data.t;
    if (!t || !t.secret) return;
    wx.setClipboardData({
      data: t.secret,
      success: () => wx.showToast({ title: '暗号已复制', icon: 'none' }),
    });
  },

  onCancelReg() {
    const t = this.data.t;
    if (!t || this.data.readonly) return;
    if (t.status !== 'registration') {
      wx.showToast({ title: '报名已锁定，无法取消', icon: 'none' });
      return;
    }
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

  /* 比赛创建者或管理员：点击报名名片弹出操作面板（移入替补/移回队员/移除） */
  onMemberTap(e) {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage || t.status !== 'registration') return;
    this.setData({
      memberAction: {
        show: true,
        openid: e.currentTarget.dataset.openid,
        nickname: e.currentTarget.dataset.nickname,
        role: e.currentTarget.dataset.role,
      },
    });
  },

  onCloseMemberAction() {
    this.setData({ 'memberAction.show': false });
  },

  onRemoveReg(e) {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage) return;
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
              this.onCloseMemberAction();
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* 比赛创建者或管理员：队员 <-> 替补 双向移动 */
  onMoveReg(e) {
    const t = this.data.t;
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    const to = e.currentTarget.dataset.to;
    if (!t || this.data.readonly || !this.data.canManage) return;
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
              this.onCloseMemberAction();
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* 队长：设置队伍名称 */
  onOpenTeamModal() {
    const myReg = this.data.myReg;
    if (this.data.readonly || !myReg || myReg.role !== 'captain' || !this.data.t || this.data.t.status !== 'registration') return;
    this.setData({
      showTeamModal: true,
      teamNameInput: myReg.teamName || '',
      teamIconInput: myReg.teamIcon || '',
      teamNameDirty: true,
    });
  },

  onCloseTeamModal() {
    if (this.data.teamNameSaving) return;
    const myReg = this.data.myReg || {};
    this.setData({
      showTeamModal: false,
      teamNameInput: myReg.teamName || '',
      teamIconInput: myReg.teamIcon || '',
      teamNameDirty: false,
    });
  },

  onTeamNameInput(e) {
    this.setData({ teamNameInput: e.detail.value, teamNameDirty: true });
  },

  onTeamIconSelect(e) {
    this.setData({ teamIconInput: e.currentTarget.dataset.id, teamNameDirty: true });
  },

  onTeamIconClear() {
    this.setData({ teamIconInput: '', teamNameDirty: true });
  },

  onSaveTeamName() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.myReg || this.data.myReg.role !== 'captain' || t.status !== 'registration') return;
    if (this.data.teamNameSaving) return;
    const teamName = (this.data.teamNameInput || '').trim();
    if (teamName.length > 10) {
      wx.showToast({ title: '队伍名称最多 10 个字', icon: 'none' });
      return;
    }
    this.setData({ teamNameSaving: true });
    api
      .call('setTeamName', { id: t.id, teamName, teamIcon: this.data.teamIconInput || '' })
      .then(() => {
        wx.showToast({ title: '队名和队标已保存', icon: 'success' });
        this.setData({ teamNameSaving: false, showTeamModal: false, teamNameInput: teamName, teamNameDirty: false });
        return this.load();
      })
      .catch((err) => {
        this.setData({ teamNameSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onEditConfig() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage) return;
    wx.navigateTo({ url: '/pages/create/create?id=' + t.id });
  },

  /* ---------- 系统分组（比赛创建者或最高管理员） ---------- */
  onAutoGroup() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage || this.data.grouping) return;
    this.setData({ grouping: true });
    api
      .call('autoGroup', { id: t.id })
      .then((d) => {
        const groups = (d.groups || []).map((group) => (group.members || []).map((member) => member.openid));
        return api.call('confirmGroup', { id: t.id, groups });
      })
      .then(() => {
        wx.showToast({ title: '分组完成', icon: 'success' });
        this.stopPoll();
        setTimeout(() => wx.redirectTo({ url: '/pages/bracket/bracket?id=' + t.id }), 600);
      })
      .catch((err) => {
        this.setData({ grouping: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onStartDraft() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage) return;
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

  onFillTestData() {
    const t = this.data.t;
    if (!t || this.data.readonly || !t.isSuper || t.status !== 'registration' || this.data.testFillSubmitting) return;
    wx.showModal({
      title: '用测试数据补全报名',
      content: '只补齐尚未报满的名额；队长模式会补齐队长、队员和替补，系统分组模式会补齐队员和替补。现有报名不变。确定继续？',
      confirmText: '补全报名',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ testFillSubmitting: true });
        api.call('fillTestRegistrations', { id: t.id })
          .then((result) => {
            if (!result.added) {
              wx.showToast({ title: '报名和替补名额已满', icon: 'none' });
              this.load(true);
              return;
            }
            wx.showToast({ title: '已补全测试数据，新增 ' + result.added + ' 人', icon: 'success' });
            this.load(true);
          })
          .catch((err) => wx.showToast({ title: err.message || '补全失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ testFillSubmitting: false }));
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

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  goBack() {
    wx.navigateBack();
  },

  noop() {},
});
