// pages/staff/staff.js - 我的（资料 + 超管用户列表查看）
const { buildCareerView, summarizeCareer } = require('../../utils/career');
const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/date-time');
const { hasCurrentRankVerification, rankVerifiedAt, normalizeRankTier, dotaRankLabel, leaderboardRank, estimateMmrFromRankTier } = require('../../utils/dota-rank');
const { buildDotaLookupView } = require('../../utils/dota-lookup-view');

const { formatRolesText } = require('../../utils/roles');

function fmtRoles(roles) {
  return formatRolesText(roles, ' / ');
}

function fmtMmr(mmr) {
  if (mmr === null || mmr === undefined || mmr === '') return '';
  return '天梯 ' + mmr;
}

function rankLabelFor(user, verified) {
  if (!verified) return '未校验段位';
  const label = dotaRankLabel(user.dota2RankTier);
  return label === '未知段位' ? '未校验段位' : label;
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
    adminOpenids: [],
    // 普通管理员名册（带昵称），弹窗顶部直接展示，避免逐页找蓝色标签
    adminRoster: [],
    createPermissionRoster: [],
    adminsSaving: false,
    createPermissionSaving: '',
    banEditorVisible: false,
    banTarget: null,
    banSaving: false,
    liftingOpenid: '',
    canInitializeSuperAdmin: false,
    bootstrapOpenid: '',
    // 超管：只读用户列表
    userListModal: false,
    userList: [],
    listLoading: false,
    userListError: '',
    userListPage: 1,
    userListPageSize: 20,
    userListTotal: 0,
    userListPageCount: 1,
    userListSortBy: 'nickname',
    userListOrder: 'asc',
    userListKeyword: '',
    // 资料编辑弹窗
    profileModal: false,
    pf: {
      nickname: '',
      mmr: '',
      dota2Id: '',
      dotaRankVerified: false,
      dota2RankLabel: '未校验段位',
      dota2EstimatedMmr: null,
      dota2RankTier: null,
      dota2LeaderboardRank: null,
      dota2RankVerifiedAt: null,
      dotaRankVerifiedAtText: '',
      dotaRankConfirmed: false,
      roles: [],
      rolesActive: [false, false, false, false, false],
      signature: '',
    },
    lookingUpDota: false,
    saving: false,
    career: null,
    careerLoading: false,
    careerError: '',
  },

  onShow() {
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
          adminOpenids: Array.isArray(d.admins) ? d.admins : [],
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

  /* ---------- 最高管理员：只读用户列表 ---------- */

  onOpenUserList() {
    if (!this.data.isSuper) return;
    this.setData({
      userListModal: true,
      userList: [],
      userListPage: 1,
      userListTotal: 0,
      userListPageCount: 1,
      userListSortBy: 'nickname',
      userListOrder: 'asc',
      userListKeyword: '',
    });
    this.loadUserList({ page: 1, sortBy: 'nickname', order: 'asc' });
  },

  loadUserList(options) {
    const opts = options || {};
    if (!this.data.isSuper) return Promise.resolve();
    const page = Math.max(1, Number(opts.page || this.data.userListPage) || 1);
    const sortBy = opts.sortBy || this.data.userListSortBy;
    const order = opts.order || this.data.userListOrder;
    const keyword = opts.keyword !== undefined ? String(opts.keyword || '') : this.data.userListKeyword;
    // 搜索可能在前一次请求未结束时继续触发，只让最后一次请求更新列表。
    const requestId = (this._userListRequestId || 0) + 1;
    this._userListRequestId = requestId;
    this.setData({ listLoading: true, userListError: '', userListKeyword: keyword });
    return api
      .call('listUsers', {
        page,
        pageSize: this.data.userListPageSize,
        sortBy,
        order,
        keyword,
      })
      .then((d) => {
        if (requestId !== this._userListRequestId) return;
        const users = (d.users || []).map((user) => Object.assign({}, user, {
          mmrText: user.mmr === null || user.mmr === undefined || user.mmr === '' ? '未填写天梯分' : '天梯 ' + user.mmr,
          dotaIdText: user.dota2Id || '未填写 ID',
          rankText: user.dota2RankVerified ? user.dota2RankLabel : '未校验段位',
          isAdminUser: this.data.adminOpenids.indexOf(user.openid) >= 0,
        }));
        const total = Number(d.total) || 0;
        const roster = Array.isArray(d.adminRoster) ? d.adminRoster : [];
        this.setData({
          userList: users,
          adminRoster: roster,
          createPermissionRoster: Array.isArray(d.createPermissionRoster) ? d.createPermissionRoster : [],
          userListPage: Number(d.page) || page,
          userListPageSize: Number(d.pageSize) || this.data.userListPageSize,
          userListTotal: total,
          userListPageCount: Math.max(1, Math.ceil(total / (Number(d.pageSize) || this.data.userListPageSize))),
          userListSortBy: d.sortBy || sortBy,
          userListOrder: d.order || order,
          userListKeyword: d.keyword === undefined ? keyword : d.keyword,
          listLoading: false,
        });
      })
      .catch((e) => {
        if (requestId !== this._userListRequestId) return;
        this.setData({ listLoading: false, userListError: e.message || '用户列表加载失败，请重试' });
      });
  },

  onRetryUserList() {
    this.loadUserList();
  },

  runUserSearch(value) {
    if (this._userSearchTimer) clearTimeout(this._userSearchTimer);
    this._userSearchTimer = null;
    const keyword = String(value || '');
    this.setData({ userListKeyword: keyword, userListPage: 1 });
    this.loadUserList({ page: 1, keyword });
  },

  onUserSearchInput(e) {
    const keyword = String(e.detail.value || '');
    this.setData({ userListKeyword: keyword });
    if (this._userSearchTimer) clearTimeout(this._userSearchTimer);
    this._userSearchTimer = setTimeout(() => this.runUserSearch(keyword), 400);
  },

  onUserSearchConfirm(e) {
    this.runUserSearch(e.detail.value === undefined ? this.data.userListKeyword : e.detail.value);
  },

  onClearUserSearch() {
    this.runUserSearch('');
  },

  onChangeUserSort(e) {
    if (this.data.listLoading) return;
    const sortBy = String(e.currentTarget.dataset.sort || 'nickname');
    const order = sortBy === this.data.userListSortBy && this.data.userListOrder === 'asc' ? 'desc' : 'asc';
    this.setData({
      userList: [],
      userListPage: 1,
      userListSortBy: sortBy,
      userListOrder: order,
    });
    this.loadUserList({ page: 1, sortBy, order });
  },

  onChangeUserPage(e) {
    if (this.data.listLoading) return;
    const nextPage = this.data.userListPage + Number(e.currentTarget.dataset.delta || 0);
    if (nextPage < 1 || nextPage > this.data.userListPageCount) return;
    this.loadUserList({ page: nextPage });
  },

  onCloseUserList() {
    if (this._userSearchTimer) clearTimeout(this._userSearchTimer);
    this._userSearchTimer = null;
    this._userListRequestId = (this._userListRequestId || 0) + 1;
    this.setData({ userListModal: false, listLoading: false, banEditorVisible: false, banTarget: null });
  },

  /* ---------- 超管：设置 / 取消普通管理员（全量提交，≤ 20 人） ---------- */

  // 全量提交普通管理员名单（≤ 20 人）：设置与取消都走这里，成功后刷新列表与名册
  commitAdmins(admins) {
    this.setData({ adminsSaving: true });
    return api
      .call('setAdmins', { openids: admins })
      .then((d) => {
        this.setData({
          adminOpenids: Array.isArray(d.admins) ? d.admins : admins,
          adminsSaving: false,
        });
        wx.showToast({ title: '已更新', icon: 'success' });
        this.loadUserList({ page: this.data.userListPage });
      })
      .catch((err) => {
        this.setData({ adminsSaving: false });
        wx.showToast({ title: err.message || '设置失败，请重试', icon: 'none' });
      });
  },

  onToggleAdmin(e) {
    if (!this.data.isSuper || this.data.adminsSaving || !this.data.userListModal) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    if (!openid) return;
    const admins = this.data.adminOpenids.slice();
    const i = admins.indexOf(openid);
    if (i >= 0) {
      admins.splice(i, 1);
    } else {
      admins.push(openid);
    }
    this.commitAdmins(admins);
  },

  updateCreatePermission(user, allowed) {
    if (!this.data.isSuper || this.data.createPermissionSaving || !this.data.userListModal || !user) return;
    const openid = user.openid;
    const nickname = user.nickname || '该用户';
    wx.showModal({
      title: allowed ? '开通创建比赛权限' : '取消创建比赛权限',
      content: allowed
        ? '允许 ' + nickname + ' 创建比赛？获授权后每天最多创建 20 场。'
        : '取消后 ' + nickname + ' 将不能创建新比赛，已创建的比赛不受影响。',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ createPermissionSaving: openid });
        api.call('setUserCreatePermission', { targetOpenid: openid, allowed })
          .then(() => {
            this.setData({ createPermissionSaving: '' });
            wx.showToast({ title: allowed ? '已开通' : '已取消', icon: 'success' });
            // 同时刷新当前页和完整授权名册，搜索结果不会影响名册统计。
            this.loadUserList({ page: this.data.userListPage });
          })
          .catch((error) => {
            this.setData({ createPermissionSaving: '' });
            wx.showToast({ title: error.message || '权限设置失败', icon: 'none' });
          });
      },
    });
  },

  onToggleCreatePermission(e) {
    const openid = String(e.currentTarget.dataset.openid || '');
    const user = (this.data.userList || []).find((item) => item.openid === openid);
    if (user) this.updateCreatePermission(user, !user.canCreateTournament);
  },

  onRemoveRosterCreatePermission(e) {
    const openid = String(e.currentTarget.dataset.openid || '');
    const user = (this.data.createPermissionRoster || []).find((item) => item.openid === openid);
    if (user) this.updateCreatePermission(user, false);
  },

  // 名册里点「×」直接取消，不弹确认框
  onRemoveRosterAdmin(e) {
    if (!this.data.isSuper || this.data.adminsSaving || !this.data.userListModal) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    if (!openid) return;
    const admins = this.data.adminOpenids.filter((id) => id !== openid);
    this.commitAdmins(admins);
  },

  /* ---------- 超管：设置、调整和解除禁赛 ---------- */

  onOpenBanEditor(e) {
    if (!this.data.isSuper || this.data.banSaving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    const target = (this.data.userList || []).find((item) => item.openid === openid);
    if (!target || target.isSuper) return;
    this.setData({ banEditorVisible: true, banTarget: target });
  },

  onCloseBanEditor() {
    if (!this.data.banSaving) this.setData({ banEditorVisible: false, banTarget: null });
  },

  onSubmitUserBan(e) {
    if (!this.data.isSuper || this.data.banSaving) return;
    const detail = e.detail || {};
    this.setData({ banSaving: true });
    api.call('setUserBan', detail)
      .then(() => {
        this.setData({ banSaving: false, banEditorVisible: false, banTarget: null });
        wx.showToast({ title: '禁赛已更新', icon: 'success' });
        this.loadUserList({ page: this.data.userListPage });
      })
      .catch((error) => {
        this.setData({ banSaving: false });
        wx.showToast({ title: error.message || '禁赛设置失败', icon: 'none' });
      });
  },

  onLiftUserBan(e) {
    if (!this.data.isSuper || this.data.liftingOpenid || this.data.banSaving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    const target = (this.data.userList || []).find((item) => item.openid === openid);
    if (!target || !target.ban) return;
    wx.showModal({
      title: '解除禁赛',
      content: '解除后 ' + target.nickname + ' 将立即恢复报名参赛资格。确定继续？',
      confirmText: '确认解除',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ liftingOpenid: openid });
        api.call('liftUserBan', { targetOpenid: openid })
          .then(() => {
            this.setData({ liftingOpenid: '' });
            wx.showToast({ title: '已解除禁赛', icon: 'success' });
            this.loadUserList({ page: this.data.userListPage });
          })
          .catch((error) => {
            this.setData({ liftingOpenid: '' });
            wx.showToast({ title: error.message || '解除失败', icon: 'none' });
          });
      },
    });
  },

  /* ---------- 资料编辑 ---------- */

  onEditProfile() {
    const u = this.data.user || {};
    const hasRankVerification = hasCurrentRankVerification(u);
    const verifiedAt = rankVerifiedAt(u);
    const savedSnapshot = u.dota2LookupSnapshot;
    const savedLookup = savedSnapshot &&
      String(savedSnapshot.accountId || '') === String(u.dota2Id || '') &&
      Number(savedSnapshot.verifiedAt) > 0
      ? buildDotaLookupView(savedSnapshot)
      : null;
    const roles = Array.isArray(u.roles) ? u.roles.filter((v) => v >= 1 && v <= 5) : [];
    const rolesActive = [false, false, false, false, false];
    roles.forEach((v) => (rolesActive[v - 1] = true));
    this.setData({
      profileModal: true,
      pf: {
        nickname: u.nickname || '',
        mmr: u.mmr === null || u.mmr === undefined || u.mmr === '' ? '' : String(u.mmr),
        dota2Id: String(u.dota2Id || ''),
        dotaRankVerified: hasRankVerification,
        dota2RankLabel: rankLabelFor(u, hasRankVerification),
        dota2EstimatedMmr: hasRankVerification ? estimateMmrFromRankTier(u.dota2RankTier) : null,
        dota2RankTier: hasRankVerification ? Number(u.dota2RankTier) : null,
        dota2LeaderboardRank: leaderboardRank(u, hasRankVerification),
        dota2RankVerifiedAt: verifiedAt || null,
        dotaRankVerifiedAtText: verifiedAt ? formatDateTime(verifiedAt) : '',
        dotaRankConfirmed: false,
        originalDota2Id: String(u.dota2Id || ''),
        originalDotaRankVerified: hasRankVerification,
        originalRankLabel: hasRankVerification ? rankLabelFor(u, true) : '',
        originalRankTier: hasRankVerification ? Number(u.dota2RankTier) : null,
        originalLeaderboardRank: hasRankVerification ? u.dota2LeaderboardRank : null,
        originalRankVerifiedAt: hasRankVerification ? verifiedAt : null,
        originalRankVerifiedAtText: hasRankVerification && verifiedAt ? formatDateTime(verifiedAt) : '',
        originalLookup: hasRankVerification ? savedLookup : null,
        dotaLookup: savedLookup,
        roles,
        rolesActive,
        signature: u.signature || '',
      },
    });
    // 老资料没有快照时自动补一次校验；保存后再次打开会直接使用快照。
    if (!savedLookup && String(u.dota2Id || '')) this.onLookupDota();
  },

  onPfNick(e) {
    this.setData({ 'pf.nickname': e.detail.value });
  },

  onPfMmr(e) {
    this.setData({ 'pf.mmr': e.detail.value });
  },

  onUseEstimatedMmr() {
    if (this.data.lookingUpDota || this.data.saving) return;
    const estimatedMmr = Number(this.data.pf.dota2EstimatedMmr);
    if (!Number.isInteger(estimatedMmr) || estimatedMmr < 1) return;
    this.setData({ 'pf.mmr': String(estimatedMmr) });
  },

  onPfDotaId(e) {
    const value = String(e.detail.value || '').trim();
    const changed = value !== this.data.pf.dota2Id;
    if (changed) this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    const restoreOriginal = changed && value === this.data.pf.originalDota2Id && this.data.pf.originalDotaRankVerified;
    const updates = {
      'pf.dota2Id': value,
    };
    if (changed && restoreOriginal) {
      Object.assign(updates, {
        'pf.dotaRankVerified': true,
        'pf.dota2RankLabel': this.data.pf.originalRankLabel,
        'pf.dota2EstimatedMmr': estimateMmrFromRankTier(this.data.pf.originalRankTier),
        'pf.dota2RankTier': this.data.pf.originalRankTier,
        'pf.dota2LeaderboardRank': this.data.pf.originalLeaderboardRank,
        'pf.dota2RankVerifiedAt': this.data.pf.originalRankVerifiedAt,
        'pf.dotaRankVerifiedAtText': this.data.pf.originalRankVerifiedAtText,
        'pf.dotaRankConfirmed': false,
        'pf.dotaLookup': this.data.pf.originalLookup || null,
        lookingUpDota: false,
      });
    } else if (changed) {
      Object.assign(updates, {
      'pf.dotaRankVerified': false,
      'pf.dota2RankLabel': '未校验段位',
      'pf.dota2EstimatedMmr': null,
      'pf.dota2RankTier': null,
      'pf.dota2LeaderboardRank': null,
      'pf.dota2RankVerifiedAt': null,
      'pf.dotaRankVerifiedAtText': '',
      'pf.dotaRankConfirmed': false,
      'pf.dotaLookup': null,
      lookingUpDota: false,
      });
    }
    this.setData(updates);
  },

  onClearDotaId() {
    if (this.data.lookingUpDota) return;
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({
      'pf.dota2Id': '',
      'pf.dotaRankVerified': false,
      'pf.dota2RankLabel': '未校验段位',
      'pf.dota2EstimatedMmr': null,
      'pf.dota2RankTier': null,
      'pf.dota2LeaderboardRank': null,
      'pf.dota2RankVerifiedAt': null,
      'pf.dotaRankVerifiedAtText': '',
      'pf.dotaRankConfirmed': false,
      'pf.dotaLookup': null,
      lookingUpDota: false,
    });
  },

  onLookupDota() {
    if (this.data.lookingUpDota) return;
    const accountId = String(this.data.pf.dota2Id || '').trim();
    if (!/^\d{5,12}$/.test(accountId)) {
      wx.showToast({ title: '请输入 5-12 位 Dota2 数字 ID', icon: 'none' });
      return;
    }
    const requestId = (this._rankLookupRequestId || 0) + 1;
    this._rankLookupRequestId = requestId;
    this.setData({ lookingUpDota: true, 'pf.dotaLookup': null, 'pf.dotaRankConfirmed': false });
    api
      .call('lookupDota', { accountId, autoSave: !!this.data.user })
      .then((result) => {
        if (requestId !== this._rankLookupRequestId || accountId !== String(this.data.pf.dota2Id || '').trim()) return;
        this.setData({ lookingUpDota: false });
        const rankTier = normalizeRankTier(result && result.rankTier);
        if (rankTier === null || rankTier <= 0) {
          wx.showToast({ title: '未查到段位，请先打完一场排位', icon: 'none' });
          return;
        }
        const rankResult = buildDotaLookupView(result);
        const updates = {
          'pf.dota2Id': String(rankResult.accountId || accountId),
          'pf.dotaRankVerified': true,
          'pf.dota2RankLabel': rankResult.rankLabel,
          'pf.dota2EstimatedMmr': rankResult.estimatedMmr,
          'pf.dota2RankTier': rankTier,
          'pf.dota2LeaderboardRank': rankResult.leaderboardRank,
          'pf.dota2RankVerifiedAt': rankResult.verifiedAt,
          'pf.dotaRankVerifiedAtText': rankResult.verifiedAtText,
          'pf.dotaRankConfirmed': true,
          'pf.dotaLookup': rankResult,
        };
        if (result.autoSaved && result.savedProfile) {
          updates.user = Object.assign({}, this.data.user, result.savedProfile);
          Object.assign(updates, {
            'pf.originalDota2Id': String(rankResult.accountId || accountId),
            'pf.originalDotaRankVerified': true,
            'pf.originalRankLabel': rankResult.rankLabel,
            'pf.originalRankTier': rankTier,
            'pf.originalLeaderboardRank': rankResult.leaderboardRank,
            'pf.originalRankVerifiedAt': rankResult.verifiedAt,
            'pf.originalRankVerifiedAtText': rankResult.verifiedAtText,
            'pf.originalLookup': rankResult,
          });
        }
        this.setData(updates);
      })
      .catch((err) => {
        if (requestId !== this._rankLookupRequestId) return;
        this.setData({ lookingUpDota: false });
        wx.showToast({ title: err.message || 'Dota2 ID 查询失败', icon: 'none' });
      });
  },

  onPfSig(e) {
    this.setData({ 'pf.signature': e.detail.value });
  },

  onToggleRole(e) {
    const v = Number(e.currentTarget.dataset.role);
    const roles = this.data.pf.roles.slice();
    const rolesActive = this.data.pf.rolesActive.slice();
    const i = roles.indexOf(v);
    if (i >= 0) {
      roles.splice(i, 1);
      rolesActive[v - 1] = false;
    } else {
      roles.push(v);
      rolesActive[v - 1] = true;
    }
    this.setData({ 'pf.roles': roles.sort((a, b) => a - b), 'pf.rolesActive': rolesActive });
  },

  onSaveProfile() {
    if (this.data.saving || this.data.lookingUpDota) return;
    const pf = this.data.pf;
    const nickname = (pf.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (nickname.length > 20) {
      wx.showToast({ title: '昵称最多 20 个字', icon: 'none' });
      return;
    }
    const sig = (pf.signature || '').trim();
    if (sig.length > 25) {
      wx.showToast({ title: '个人签名最多 25 个字', icon: 'none' });
      return;
    }
    if ((pf.mmr || '').trim() === '') {
      wx.showToast({ title: '请填写天梯分', icon: 'none' });
      return;
    }
    const mmr = Number(pf.mmr);
    if (!Number.isInteger(mmr) || mmr < 1 || mmr > 20000) {
      wx.showToast({ title: '天梯分需在 1-20000 之间', icon: 'none' });
      return;
    }
    if (pf.roles.length === 0) {
      wx.showToast({ title: '请至少选择一个常玩位置', icon: 'none' });
      return;
    }
    const rankConfirmed = pf.dotaRankConfirmed === true && pf.dotaRankVerified === true;
    const originalId = String(pf.originalDota2Id || '').trim();
    const currentId = String(pf.dota2Id || '').trim();
    if (currentId && currentId !== originalId && !rankConfirmed) {
      wx.showToast({ title: '更换 Dota 2 ID 前请先完成段位校验', icon: 'none' });
      return;
    }
    const dota2Id = currentId;
    this.setData({ saving: true });
    api
      .call('saveProfile', {
        nickname,
        mmr,
        dota2Id,
        ...(rankConfirmed ? {
          dotaRankConfirmed: true,
          dota2RankTier: pf.dota2RankTier,
          dota2LeaderboardRank: pf.dota2LeaderboardRank,
        } : {}),
        roles: this.data.pf.roles,
        signature: sig,
      })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({ profileModal: false, saving: false });
        this.load();
      })
      .catch((err) => {
        this.setData({ saving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onCloseProfile() {
    if (this.data.saving) return;
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({ profileModal: false, lookingUpDota: false });
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

  noop() {},

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
