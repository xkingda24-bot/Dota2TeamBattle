// pages/staff/staff.js - 我的（资料 + 管理员管理；所有用户可看，超管可管理）
const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/date-time');
const { hasCurrentRankVerification, rankVerifiedAt, normalizeRankTier, dotaRankLabel, leaderboardRank } = require('../../utils/dota-rank');

const ROLE_LABELS = ['', '1号位', '2号位', '3号位', '4号位', '5号位'];

function fmtRoles(roles) {
  const arr = Array.isArray(roles) ? roles.filter((v) => v >= 1 && v <= 5) : [];
  return arr.length ? arr.map((v) => ROLE_LABELS[v]).join(' / ') : '';
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
    admins: [],
    isAdmin: false,
    isSuper: false,
    canInitializeSuperAdmin: false,
    bootstrapOpenid: '',
    // 超管：管理员管理
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
    userActionOpenid: '',
    // 资料编辑弹窗
    profileModal: false,
    pf: {
      nickname: '',
      mmr: '',
      dota2Id: '',
      dotaRankVerified: false,
      dota2RankLabel: '未校验段位',
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
  },

  onShow() {
    this.load();
  },

  load() {
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
          admins: d.admins || [],
          isAdmin: !!d.isAdmin,
          isSuper: !!d.isSuper,
          canInitializeSuperAdmin: !!d.canInitializeSuperAdmin,
          bootstrapOpenid: d.bootstrapOpenid || '',
          loading: false,
          hasLoaded: true,
          loadError: '',
          refreshError: false,
        });
      })
      .catch((e) => {
        const hasData = this.data.hasLoaded;
        this.setData({
          loading: false,
          loadError: hasData ? '' : (e.message || '加载失败，请重试'),
          refreshError: hasData,
        });
        if (!hasData) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  retryLoad() {
    this.load();
  },

  /* ---------- 最高管理员：用户 / 管理员管理 ---------- */

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
    });
    this.loadUserList({ page: 1, sortBy: 'nickname', order: 'asc' });
  },

  loadUserList(options) {
    const opts = options || {};
    if (!this.data.isSuper || this.data.listLoading || (this.data.userActionOpenid && !opts.allowDuringAction)) return;
    const page = Math.max(1, Number(opts.page || this.data.userListPage) || 1);
    const sortBy = opts.sortBy || this.data.userListSortBy;
    const order = opts.order || this.data.userListOrder;
    this.setData({ listLoading: true, userListError: '' });
    return api
      .call('listUsers', {
        page,
        pageSize: this.data.userListPageSize,
        sortBy,
        order,
      })
      .then((d) => {
        const users = (d.users || []).map((user) => Object.assign({}, user, {
          mmrText: user.mmr === null || user.mmr === undefined || user.mmr === '' ? '未填写天梯分' : '天梯 ' + user.mmr,
          dotaIdText: user.dota2Id || '未填写 ID',
          rankText: user.dota2RankVerified ? user.dota2RankLabel : '未校验段位',
        }));
        const total = Number(d.total) || 0;
        this.setData({
          userList: users,
          userListPage: Number(d.page) || page,
          userListPageSize: Number(d.pageSize) || this.data.userListPageSize,
          userListTotal: total,
          userListPageCount: Math.max(1, Math.ceil(total / (Number(d.pageSize) || this.data.userListPageSize))),
          userListSortBy: d.sortBy || sortBy,
          userListOrder: d.order || order,
          listLoading: false,
        });
      })
      .catch((e) => {
        this.setData({ listLoading: false, userListError: e.message || '用户列表加载失败，请重试' });
      });
  },

  onRetryUserList() {
    this.loadUserList();
  },

  onChangeUserSort(e) {
    if (this.data.listLoading || this.data.userActionOpenid) return;
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
    if (this.data.listLoading || this.data.userActionOpenid) return;
    const nextPage = this.data.userListPage + Number(e.currentTarget.dataset.delta || 0);
    if (nextPage < 1 || nextPage > this.data.userListPageCount) return;
    this.loadUserList({ page: nextPage });
  },

  onToggleUserAdmin(e) {
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    const isAdmin = e.currentTarget.dataset.admin === true || String(e.currentTarget.dataset.admin) === 'true';
    if (!openid || this.data.userActionOpenid || this.data.listLoading) return;
    if (openid === this.data.superAdminOpenid) return;
    wx.showModal({
      title: isAdmin ? '移除管理员' : '设置管理员',
      content: isAdmin ? '确定移除 ' + (nickname || '该用户') + ' 的管理员权限吗？' : '确定将 ' + (nickname || '该用户') + ' 设为管理员吗？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ userActionOpenid: openid });
        api.call(isAdmin ? 'removeAdmin' : 'addAdmin', { openid })
          .then(() => {
            this.load();
            this.loadUserList({ allowDuringAction: true });
            wx.showToast({ title: isAdmin ? '已移除管理员' : '已设置为管理员', icon: 'success' });
          })
          .catch((err) => wx.showToast({ title: err.message || '操作失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ userActionOpenid: '' }));
      },
    });
  },

  onDeleteUser(e) {
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname || '未设置昵称用户';
    const dota2Id = e.currentTarget.dataset.dotaid || '';
    if (!openid || this.data.userActionOpenid || this.data.listLoading) return;
    if (openid === this.data.superAdminOpenid) return;
    wx.showModal({
      title: '删除用户账号',
      content: '确定删除“' + nickname + '”的小程序资料吗？' + (dota2Id ? '\nDota ID：' + dota2Id : '') + '\n删除后会撤销管理员权限；既有比赛报名、赛果和感言快照会保留。微信登录身份不受影响，之后可重新创建资料。',
      confirmText: '删除账号',
      confirmColor: '#d94a42',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ userActionOpenid: openid });
        api.call('deleteUser', { openid })
          .then(() => {
            const page = this.data.userList.length === 1 && this.data.userListPage > 1
              ? this.data.userListPage - 1
              : this.data.userListPage;
            this.load();
            this.loadUserList({ page, allowDuringAction: true });
            wx.showToast({ title: '用户账号已删除', icon: 'success' });
          })
          .catch((err) => wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ userActionOpenid: '' }));
      },
    });
  },

  onCloseUserList() {
    if (this.data.userActionOpenid) return;
    this.setData({ userListModal: false });
  },

  /* ---------- 资料编辑 ---------- */

  onEditProfile() {
    const u = this.data.user || {};
    const hasRankVerification = hasCurrentRankVerification(u);
    const verifiedAt = rankVerifiedAt(u);
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
        dotaLookup: hasRankVerification
          ? {
              accountId: String(u.dota2Id),
              nickname: u.dota2Nickname || '未知玩家',
              leaderboardRank: leaderboardRank(u, hasRankVerification),
              rankTier: Number(u.dota2RankTier),
              rankLabel: rankLabelFor(u, hasRankVerification),
            }
          : null,
        roles,
        rolesActive,
        signature: u.signature || '',
      },
    });
  },

  onPfNick(e) {
    this.setData({ 'pf.nickname': e.detail.value });
  },

  onPfMmr(e) {
    this.setData({ 'pf.mmr': e.detail.value });
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
        'pf.dota2RankTier': this.data.pf.originalRankTier,
        'pf.dota2LeaderboardRank': this.data.pf.originalLeaderboardRank,
        'pf.dota2RankVerifiedAt': this.data.pf.originalRankVerifiedAt,
        'pf.dotaRankVerifiedAtText': this.data.pf.originalRankVerifiedAtText,
        'pf.dotaRankConfirmed': false,
        'pf.dotaLookup': null,
        lookingUpDota: false,
      });
    } else if (changed) {
      Object.assign(updates, {
      'pf.dotaRankVerified': false,
      'pf.dota2RankLabel': '未校验段位',
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
    this.setData({ lookingUpDota: true });
    api
      .call('lookupDota', { accountId })
      .then((result) => {
        if (requestId !== this._rankLookupRequestId || accountId !== String(this.data.pf.dota2Id || '').trim()) return;
        this.setData({ lookingUpDota: false });
        const rankTier = normalizeRankTier(result && result.rankTier);
        if (rankTier === null || rankTier <= 0) {
          wx.showToast({ title: '未查到段位，请先打完一场排位', icon: 'none' });
          return;
        }
        const rankLabel = rankLabelFor({ dota2RankTier: rankTier }, true);
        const rankPosition = leaderboardRank(result, true);
        const rankResult = Object.assign({}, result, { rankTier, rankLabel, leaderboardRank: rankPosition });
        wx.showModal({
          title: '确认段位校验',
          content: 'Dota ID：' + (result.accountId || accountId) + '\n段位：' + rankLabel,
          confirmText: '确认使用',
          success: (modalResult) => {
            if (!modalResult.confirm || accountId !== String(this.data.pf.dota2Id || '').trim()) return;
            const verifiedAt = Number(result.verifiedAt) || Date.now();
            this.setData({
              'pf.dota2Id': String(result.accountId || accountId),
              'pf.dotaRankVerified': true,
              'pf.dota2RankLabel': rankLabel,
              'pf.dota2RankTier': rankTier,
              'pf.dota2LeaderboardRank': rankPosition,
              'pf.dota2RankVerifiedAt': verifiedAt,
              'pf.dotaRankVerifiedAtText': formatDateTime(verifiedAt),
              'pf.dotaRankConfirmed': true,
              'pf.dotaLookup': rankResult,
            });
          },
        });
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
    if (sig.length > 15) {
      wx.showToast({ title: '个人签名最多 15 个字', icon: 'none' });
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

  goTeamLogos() {
    if (!this.data.isSuper) {
      wx.showToast({ title: '仅最高管理员可以管理队标库', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/team-logos/team-logos' });
  },

  noop() {},

  /* ---------- 管理员 ---------- */

  remove(e) {
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    wx.showModal({
      title: '移除管理员',
      content: '确定移除 ' + nickname + ' 的管理员权限吗？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('removeAdmin', { openid })
            .then(() => {
              wx.showToast({ title: '已移除', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  initSuper() {
    wx.showModal({
      title: '初始化最高管理员',
      content: '当前微信账号已被指定为初始超管。初始化后，你将获得添加和移除管理员的权限。确定继续？',
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
