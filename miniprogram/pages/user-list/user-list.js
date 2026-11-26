// pages/user-list/user-list.js - 超管用户列表（独立页面，原 staff 弹窗迁移）
const api = require('../../utils/api');

const SEARCH_ICON = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8d96a3" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>'
);

Page({
  data: {
    pageLoading: true,
    pageError: '',
    forbidden: false,
    isSuper: false,
    adminOpenids: [],
    // 普通管理员名册（带昵称），页面顶部直接展示，避免逐页找蓝色标签
    adminRoster: [],
    createPermissionRoster: [],
    rosterExpanded: '',
    adminsSaving: false,
    createPermissionSaving: '',
    banEditorVisible: false,
    banTarget: null,
    banSaving: false,
    liftingOpenid: '',
    userList: [],
    searchIcon: SEARCH_ICON,
    listLoading: false,
    userListError: '',
    userListPage: 1,
    userListPageSize: 20,
    userListTotal: 0,
    userListPageCount: 1,
    userListSortBy: 'nickname',
    userListOrder: 'asc',
    userListKeyword: '',
  },

  onLoad() {
    this.bootstrap();
  },

  onUnload() {
    if (this._userSearchTimer) clearTimeout(this._userSearchTimer);
    this._userSearchTimer = null;
    this._userListRequestId = (this._userListRequestId || 0) + 1;
  },

  /* 进入页面先确认超管身份并拿到管理员名单，再加载用户列表 */
  bootstrap() {
    this.setData({ pageLoading: true, pageError: '', forbidden: false });
    return api
      .call('getStaff')
      .then((d) => {
        const isSuper = !!d.isSuper;
        this.setData({
          isSuper,
          adminOpenids: Array.isArray(d.admins) ? d.admins : [],
          pageLoading: false,
          forbidden: !isSuper,
        });
        if (isSuper) return this.loadUserList({ page: 1, sortBy: 'nickname', order: 'asc' });
        return null;
      })
      .catch((e) => {
        this.setData({ pageLoading: false, pageError: e.message || '加载失败，请重试' });
      });
  },

  retryBootstrap() {
    this.bootstrap();
  },

  /* 统计概览：点击展开对应人员名单，两个名单互斥，再次点击收起 */
  onToggleRoster(e) {
    const key = String(e.currentTarget.dataset.roster || '');
    if (key !== 'admin' && key !== 'create') return;
    this.setData({ rosterExpanded: this.data.rosterExpanded === key ? '' : key });
  },

  /* ---------- 用户列表：加载、搜索、排序、分页 ---------- */

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

  /* ---------- 点击用户名片：底部动作面板汇总权限与禁赛操作 ---------- */

  onUserRowTap(e) {
    if (!this.data.isSuper) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    const user = (this.data.userList || []).find((item) => item.openid === openid);
    if (!user || user.isSuper) return;
    const actions = [];
    if (!user.isAdminUser) actions.push({ key: 'create', text: user.canCreateTournament ? '取消创建权限' : '开通创建权限' });
    actions.push({ key: 'admin', text: user.isAdminUser ? '取消管理员' : '设为管理员' });
    actions.push({ key: 'ban', text: user.ban ? '调整禁赛' : '禁赛' });
    if (user.ban) actions.push({ key: 'lift', text: '解除禁赛' });
    wx.showActionSheet({
      itemList: actions.map((action) => action.text),
      success: (res) => {
        const action = actions[res.tapIndex];
        if (!action) return;
        if (action.key === 'create') this.updateCreatePermission(user, !user.canCreateTournament);
        else if (action.key === 'admin') this.toggleAdmin(user);
        else if (action.key === 'ban') this.openBanEditor(user);
        else if (action.key === 'lift') this.liftUserBan(user);
      },
    });
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

  toggleAdmin(user) {
    if (!this.data.isSuper || this.data.adminsSaving || !user) return;
    const openid = user.openid;
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
    if (!this.data.isSuper || this.data.createPermissionSaving || !user) return;
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

  onRemoveRosterCreatePermission(e) {
    const openid = String(e.currentTarget.dataset.openid || '');
    const user = (this.data.createPermissionRoster || []).find((item) => item.openid === openid);
    if (user) this.updateCreatePermission(user, false);
  },

  // 名册里点「×」直接取消，不弹确认框
  onRemoveRosterAdmin(e) {
    if (!this.data.isSuper || this.data.adminsSaving) return;
    const openid = String(e.currentTarget.dataset.openid || '');
    if (!openid) return;
    const admins = this.data.adminOpenids.filter((id) => id !== openid);
    this.commitAdmins(admins);
  },

  /* ---------- 超管：设置、调整和解除禁赛 ---------- */

  openBanEditor(user) {
    if (!this.data.isSuper || this.data.banSaving || !user || user.isSuper) return;
    this.setData({ banEditorVisible: true, banTarget: user });
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

  liftUserBan(target) {
    if (!this.data.isSuper || this.data.liftingOpenid || this.data.banSaving || !target || !target.ban) return;
    const openid = target.openid;
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
});
