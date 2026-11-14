/**
 * pages/history/history.js - 完整历史赛事
 *
 * 数据来自 listHistory 的 createdAt 游标分页：每次只取一页，滚动到底或点「加载更多」再取下一页，
 * 历史再多也不会被截断。支持按赛季筛选（赛季口径与赛季积分一致）和按赛事名搜索。
 */
const api = require('../../utils/api');
const tournamentEntry = require('../../utils/tournament-entry');
const { getTodayBoundary } = require('../../utils/date-time');
const { itemId, mergeHistoryPage } = require('../../utils/history-merge');

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE = 450;

function phaseText(status) {
  if (status === 'registration') return '报名中';
  if (status === 'draft') return '选人中';
  if (status === 'battle') return '对战中';
  return '已结束';
}

function decorate(item) {
  return Object.assign({}, item, {
    phaseText: phaseText(item.status),
    phaseClass:
      item.status === 'registration'
        ? 'phase-registration'
        : item.status === 'draft'
        ? 'phase-draft'
        : item.status === 'battle'
        ? 'phase-battle'
        : 'phase-finished',
  });
}

Page({
  data: {
    items: [],
    loading: false,
    loadingMore: false,
    error: '',
    hasMore: false,
    cursorCreatedAt: 0,
    cursorId: '',
    keywordInput: '',
    keyword: '',
    seasonId: '',
    seasons: [],
    currentSeasonId: '',
    deleteBusyId: '',
    // 报名阶段进赛事的暗号弹窗
    secretModal: false,
    secretTargetId: '',
    secretTargetName: '',
    secretInput: '',
    secretChecking: false,
  },

  onLoad() {
    this.loadFirstPage();
  },

  onPullDownRefresh() {
    this.loadFirstPage().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  /* ---------- 数据加载 ---------- */

  loadFirstPage() {
    this._requestId = (this._requestId || 0) + 1;
    const requestId = this._requestId;
    this.setData({
      loading: true,
      loadingMore: false,
      error: '',
      items: [],
      hasMore: false,
      cursorCreatedAt: 0,
      cursorId: '',
    });
    return this.fetchPage(requestId, true);
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return Promise.resolve();
    this._requestId = (this._requestId || 0) + 1;
    const requestId = this._requestId;
    this.setData({ loadingMore: true, error: '' });
    return this.fetchPage(requestId, false);
  },

  fetchPage(requestId, reset) {
    const todayStart = getTodayBoundary(new Date());
    return api
      .call('listHistory', {
        todayStart,
        limit: PAGE_SIZE,
        cursorCreatedAt: reset ? 0 : this.data.cursorCreatedAt,
        cursorId: reset ? '' : this.data.cursorId,
        seasonId: this.data.seasonId,
        keyword: this.data.keyword,
      })
      .then((d) => {
        if (requestId !== this._requestId) return;
        const incoming = (d.older || []).map(decorate);
        const merged = mergeHistoryPage(this.data.items, incoming, reset);
        this.setData({
          items: merged,
          hasMore: !!d.hasMore,
          cursorCreatedAt: (d.nextCursor && d.nextCursor.createdAt) || 0,
          cursorId: (d.nextCursor && d.nextCursor.id) || '',
          seasons: (d.seasons && d.seasons.length ? d.seasons : this.data.seasons),
          currentSeasonId: d.currentSeasonId || this.data.currentSeasonId,
          loading: false,
          loadingMore: false,
          error: '',
        });
      })
      .catch((err) => {
        if (requestId !== this._requestId) return;
        this.setData({
          loading: false,
          loadingMore: false,
          error: err.message || '历史赛事加载失败，请重试',
        });
      });
  },

  retry() {
    if (this.data.items.length) return this.loadMore();
    return this.loadFirstPage();
  },

  /* ---------- 搜索 ---------- */

  onKeywordInput(e) {
    const value = (e.detail && e.detail.value) || '';
    this.setData({ keywordInput: value });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      const keyword = value.trim();
      if (keyword === this.data.keyword) return;
      this.setData({ keyword });
      this.loadFirstPage();
    }, SEARCH_DEBOUNCE);
  },

  onKeywordConfirm(e) {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    const keyword = ((e.detail && e.detail.value) || '').trim();
    if (keyword === this.data.keyword) return;
    this.setData({ keyword });
    this.loadFirstPage();
  },

  onClearKeyword() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!this.data.keyword && !this.data.keywordInput) return;
    this.setData({ keywordInput: '', keyword: '' });
    this.loadFirstPage();
  },

  onSelectSeason(e) {
    const seasonId = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (seasonId === this.data.seasonId) return;
    this.setData({ seasonId });
    this.loadFirstPage();
  },

  /* ---------- 进赛事 ---------- */

  openItem(e) {
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    const id = tournamentEntry.resolveId(item);
    const url = tournamentEntry.buildUrl(item);
    if (!id || !url) {
      wx.showToast({ title: '赛事编号缺失，请刷新后重试', icon: 'none' });
      return;
    }
    if (!tournamentEntry.requiresSecret(item, !!wx.getStorageSync('dota2_secret_' + id))) {
      wx.navigateTo({ url });
      return;
    }
    this.setData({
      secretModal: true,
      secretTargetId: id,
      secretTargetName: item.name,
      secretInput: '',
      secretChecking: false,
    });
  },

  onSecretInput(e) {
    this.setData({ secretInput: (e.detail && e.detail.value) || '' });
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
        wx.showToast({ title: err.message || '暗号校验失败', icon: 'none' });
      });
  },

  onCloseSecret() {
    if (this.data.secretChecking) return;
    this.setData({ secretModal: false, secretInput: '', secretTargetId: '', secretTargetName: '' });
  },

  /* ---------- 管理员删除 ---------- */

  deleteItem(e) {
    if (this.data.deleteBusyId) return;
    const item = this.data.items[Number(e.currentTarget.dataset.index)];
    if (!item || !item.canDelete) return;
    const id = itemId(item);
    if (!id) {
      wx.showToast({ title: '赛事编号缺失，请刷新后重试', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除确认',
      content: '「' + item.name + '」及其比赛数据将被删除，确定继续？',
      confirmText: '确认删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ deleteBusyId: id });
        api
          .call('deleteTournament', { id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            return this.loadFirstPage();
          })
          .catch((err) => wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ deleteBusyId: '' }));
      },
    });
  },

  noop() {},
});
