// pages/index/index.js - 主页（创建比赛 + 今天的比赛 + 历史入口）
const api = require('../../utils/api');
const { formatDateTime, getTodayBoundary } = require('../../utils/date-time');
const { normalizeRankTier, dotaRankLabel, leaderboardRank } = require('../../utils/dota-rank');
const tournamentEntry = require('../../utils/tournament-entry');
const { settleUntilDone } = require('../../utils/season-settle');

Page({
  data: {
    loading: true,
    loadError: '',
    user: null,
    isSuper: false,
    hasSuper: false,
    todayCreateCount: 0,
    todayCreateRemaining: 5,
    todayCreateLimit: 5,
    today: [],
    older: [],
    // 积分入口常驻主页；服务不可用时仍显示状态，避免功能被静默隐藏。
    seasonPointsVisible: true,
    seasonPointsEnabled: false,
    seasonPointsTitle: '2026 Q4 赛季积分',
    seasonPointsQuarter: 'Q4',
    seasonPointsValue: '—',
    seasonPointsRankText: '正在读取赛季数据…',
    seasonPointsStatus: '积分服务连接中',
    historyExpanded: false,
    historyBusyId: '',
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
    pfDota2Id: '',
    pfDotaRankVerified: false,
    pfDotaRankLabel: '未校验段位',
    pfDotaRankTier: null,
    pfDotaLeaderboardRank: null,
    pfDotaRankVerifiedAt: null,
    pfDotaRankVerifiedAtText: '',
    pfDotaRankConfirmed: false,
    pfDotaLookup: null,
    dotaLookupLoading: false,
    pfRoles: [],
    rolesActive: [false, false, false, false, false],
    pfSig: '',
  },

  // 转发给好友：主页作为固定入口，不带参数
  onShareAppMessage() {
    return {
      title: '刀塔集结 · 今晚组队开战',
      path: '/pages/index/index',
    };
  },

  // 分享到朋友圈：只能带 query，页面路径固定为当前页
  onShareTimeline() {
    return {
      title: '刀塔集结 · 今晚组队开战',
    };
  },

  onShow() {
    // scene 1154 = 从朋友圈单页模式打开，只渲染这一页且登录态受限，取数失败要给出可理解的提示
    this._timelinePreview = wx.getLaunchOptionsSync().scene === 1154;
    this._rpxScale = wx.getSystemInfoSync().windowWidth / 750;
    this.loadSeasonPointsFeature();
    this.load();
  },

  loadSeasonPointsFeature() {
    return api.callFunction('seasonPoints', 'getHomeSummary', {})
      .then((config) => {
        const seasonId = String(config && config.currentSeasonId || '');
        const match = seasonId.match(/^(\d{4})Q([1-4])$/);
        const me = config && config.me || {};
        const enabled = !!(config && config.enabled);
        const rank = Number(me.rank) || 0;
        const totalPlayers = Number(me.totalPlayers) || 0;
        this.setData({
          seasonPointsEnabled: enabled,
          seasonPointsTitle: match ? match[1] + ' Q' + match[2] + ' 赛季积分' : '赛季积分',
          seasonPointsQuarter: match ? 'Q' + match[2] : '',
          seasonPointsValue: enabled ? String(Number(me.points) || 0) : '—',
          seasonPointsRankText: !enabled
            ? '赛季积分暂未开放'
            : rank ? '第 ' + rank + ' 名 / ' + totalPlayers + ' 位玩家'
            : '暂未上榜',
          seasonPointsStatus: enabled ? '与天梯分独立计算' : '等待赛季积分服务开启',
        });
      })
      .catch(() => this.setData({
        seasonPointsEnabled: false,
        seasonPointsValue: '—',
        seasonPointsRankText: '赛季积分服务暂不可用',
        seasonPointsStatus: '部署积分服务后显示真实数据',
      }));
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, loadError: '' });
    const now = new Date();
    const todayStart = getTodayBoundary(now);
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
        const older = (d.older || []).map((item) =>
          Object.assign({}, item, {
            phaseText:
              item.status === 'registration'
                ? '报名中'
                : item.status === 'draft'
                ? '选人中'
                : item.status === 'battle'
                ? '对战中'
                : '已结束',
          })
        );
        this.setData({
          user: d.user,
          isSuper: !!d.isSuper,
          hasSuper: !!d.hasSuper,
          todayCreateCount: Number(d.todayCreateCount) || 0,
          todayCreateRemaining: d.todayCreateRemaining == null ? 5 : Number(d.todayCreateRemaining),
          todayCreateLimit: Number(d.todayCreateLimit || d.dailyLimit) || 5,
          today,
          older,
          loading: false,
          loadError: '',
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
                pfDota2Id: '',
                pfDotaRankVerified: false,
                pfDotaRankLabel: '未校验段位',
                pfDotaRankTier: null,
                pfDotaLeaderboardRank: null,
                pfDotaRankVerifiedAt: null,
                pfDotaRankVerifiedAtText: '',
                pfDotaRankConfirmed: false,
                pfDotaLookup: null,
                pfRoles: [],
                rolesActive: [false, false, false, false, false],
                pfSig: '',
              }),
            300
          );
        }
      })
      .catch((e) => {
        this.setData({
          loading: false,
          loadError: this._timelinePreview
            ? '朋友圈预览暂未取到赛事数据，点顶部「前往小程序」进入完整版查看'
            : (e.message || '赛事加载失败，请重试'),
        });
        if (!this._timelinePreview) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value });
  },

  onPfMmr(e) {
    this.setData({ pfMmr: e.detail.value });
  },

  onPfDotaId(e) {
    const value = String(e.detail.value || '').trim();
    const changed = value !== this.data.pfDota2Id;
    if (changed) this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({
      pfDota2Id: value,
      ...(changed ? {
        pfDotaRankVerified: false,
        pfDotaRankLabel: '未校验段位',
        pfDotaRankTier: null,
        pfDotaLeaderboardRank: null,
        pfDotaRankVerifiedAt: null,
        pfDotaRankVerifiedAtText: '',
        pfDotaRankConfirmed: false,
        pfDotaLookup: null,
        dotaLookupLoading: false,
      } : {}),
    });
  },

  onClearDotaId() {
    if (this.data.dotaLookupLoading || this.data.nickSaving) return;
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({
      pfDota2Id: '',
      pfDotaRankVerified: false,
      pfDotaRankLabel: '未校验段位',
      pfDotaRankTier: null,
      pfDotaLeaderboardRank: null,
      pfDotaRankVerifiedAt: null,
      pfDotaRankVerifiedAtText: '',
      pfDotaRankConfirmed: false,
      pfDotaLookup: null,
    });
  },

  onLookupDota() {
    if (this.data.dotaLookupLoading || this.data.nickSaving) return;
    const accountId = String(this.data.pfDota2Id || '').trim();
    if (!/^\d{5,12}$/.test(accountId)) {
      wx.showToast({ title: '请输入 5-12 位 Dota2 数字 ID', icon: 'none' });
      return;
    }
    const requestId = (this._rankLookupRequestId || 0) + 1;
    this._rankLookupRequestId = requestId;
    this.setData({ dotaLookupLoading: true });
    api
      .call('lookupDota', { accountId })
      .then((result) => {
        if (requestId !== this._rankLookupRequestId || accountId !== String(this.data.pfDota2Id || '').trim()) return;
        this.setData({ dotaLookupLoading: false });
        const rankTier = normalizeRankTier(result && result.rankTier);
        if (rankTier === null || rankTier <= 0) {
          wx.showToast({ title: '未查到段位，请先打完一场排位', icon: 'none' });
          return;
        }
        const rankLabel = dotaRankLabel(rankTier);
        const rankPosition = leaderboardRank(result, true);
        const rankResult = Object.assign({}, result, { rankTier, rankLabel, leaderboardRank: rankPosition });
        wx.showModal({
          title: '确认段位校验',
          content: 'Dota ID：' + (result.accountId || accountId) + '\n段位：' + rankLabel,
          confirmText: '确认使用',
          success: (modalResult) => {
            if (!modalResult.confirm || accountId !== String(this.data.pfDota2Id || '').trim()) return;
            const verifiedAt = Number(result.verifiedAt) || Date.now();
            this.setData({
              pfDota2Id: String(result.accountId || accountId),
              pfDotaRankVerified: true,
              pfDotaRankLabel: rankLabel,
              pfDotaRankTier: rankTier,
              pfDotaLeaderboardRank: rankPosition,
              pfDotaRankVerifiedAt: verifiedAt,
              pfDotaRankVerifiedAtText: formatDateTime(verifiedAt),
              pfDotaRankConfirmed: true,
              pfDotaLookup: rankResult,
            });
          },
        });
      })
      .catch((err) => {
        if (requestId !== this._rankLookupRequestId) return;
        this.setData({ dotaLookupLoading: false });
        wx.showToast({ title: err.message || 'Dota2 ID 查询失败', icon: 'none' });
      });
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
    if (this.data.nickSaving || this.data.dotaLookupLoading) return;
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
    if (sig.length > 25) {
      wx.showToast({ title: '个人签名最多 25 个字', icon: 'none' });
      return;
    }
    if ((this.data.pfMmr || '').trim() === '') {
      wx.showToast({ title: '请填写天梯分', icon: 'none' });
      return;
    }
    const mmr = Number(this.data.pfMmr);
    if (!Number.isInteger(mmr) || mmr < 1 || mmr > 20000) {
      wx.showToast({ title: '天梯分需在 1-20000 之间', icon: 'none' });
      return;
    }
    if (this.data.pfRoles.length === 0) {
      wx.showToast({ title: '请至少选择一个常玩位置', icon: 'none' });
      return;
    }
    const dota2Id = String(this.data.pfDota2Id || '').trim();
    if (dota2Id && !this.data.pfDotaRankConfirmed) {
      wx.showToast({ title: '请先完成段位校验，或清空 Dota 2 ID', icon: 'none' });
      return;
    }
    this.setData({ nickSaving: true });
    api
      .call('saveProfile', {
        nickname,
        mmr,
        dota2Id,
        ...(this.data.pfDotaRankConfirmed ? {
          dotaRankConfirmed: true,
          dota2RankTier: this.data.pfDotaRankTier,
          dota2LeaderboardRank: this.data.pfDotaLeaderboardRank,
        } : {}),
        roles: this.data.pfRoles,
        signature: sig,
      })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({
          nickModal: false,
          nickInput: '',
          nickSaving: false,
          pfMmr: '',
          pfDota2Id: '',
          pfDotaRankVerified: false,
          pfDotaRankLabel: '未校验段位',
          pfDotaRankTier: null,
          pfDotaLeaderboardRank: null,
          pfDotaRankVerifiedAt: null,
          pfDotaRankVerifiedAtText: '',
          pfDotaRankConfirmed: false,
          pfDotaLookup: null,
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
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({
      nickModal: false,
      nickInput: '',
      pfMmr: '',
      pfDota2Id: '',
      pfDotaRankVerified: false,
      pfDotaRankLabel: '未校验段位',
      pfDotaRankTier: null,
      pfDotaLeaderboardRank: null,
      pfDotaRankVerifiedAt: null,
      pfDotaRankVerifiedAtText: '',
      pfDotaRankConfirmed: false,
      pfDotaLookup: null,
      dotaLookupLoading: false,
      pfRoles: [],
      rolesActive: [false, false, false, false, false],
      pfSig: '',
    });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  },

  goSeasonPoints() {
    if (!this.data.seasonPointsEnabled) {
      wx.showToast({ title: this.data.seasonPointsStatus || '赛季积分暂不可用', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/season-points/season-points' });
  },

  toggleHistory() {
    this.setData({ historyExpanded: !this.data.historyExpanded });
  },

  /* 历史比赛条目与「今天的比赛」走同一个入口，点进去就是同一个比赛页面。 */
  goHistoryTournament(e) {
    this.openTournament(this.data.older[Number(e.currentTarget.dataset.index)]);
  },

  /* 统一入口：按比赛当前状态决定落到报名页、选人页还是比赛页。 */
  openTournament(item) {
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

  deleteFromHistory(e) {
    if (this.data.historyBusyId) return;
    const item = this.data.older[Number(e.currentTarget.dataset.index)];
    if (!item || !item.canDelete) return;
    const id = String(item.id || item._id || '');
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
        this.setData({ historyBusyId: id });
        api.call('deleteTournament', { id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            return this.load();
          })
          .catch((err) => wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ historyBusyId: '' }));
      },
    });
  },

  goTournament(e) {
    // 刚完成滑动操作时忽略本次点击（避免滑完误触进入）
    if (Date.now() < (this._blockCardTapUntil || 0)) return;
    this.openTournament(this.data.today[e.currentTarget.dataset.index]);
  },

  onLongPressTournament(e) {
    const item = this.data.today[e.currentTarget.dataset.index];
    if (!item || !item.canDelete) return;
    wx.showModal({
      title: '删除确认',
      content: '「' + item.name + '」及其报名、选人和赛程数据将被删除，确定继续？',
      confirmText: '确认删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: item.id || item._id })
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* ---------- 左滑卡片：归档 / 删除（比赛创建者或最高管理员） ---------- */
  onAdminMenu(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.today[index];
    if (!item || !item.canDelete) return;

    const canArchive = !!item.champion;
    if (!canArchive) {
      this.deleteToday(index);
      return;
    }
    const itemList = ['归档到历史', '删除比赛'];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        if (res.tapIndex < 0 || res.tapIndex >= itemList.length) return;
        const action = canArchive && res.tapIndex === 0 ? 'archive' : 'delete';
        if (action === 'delete') {
          this.deleteToday(index);
        } else {
          this.archiveToday(index);
        }
      },
    });
  },

  archiveToday(index) {
    const item = this.data.today[Number(index)];
    if (!item || !item.canDelete) return;
    wx.showModal({
      title: '归档比赛',
      content: '将「' + item.name + '」归档到历史比赛，确定归档？',
      success: (res) => {
        if (!res.confirm) return;
        api
          .call('finishTournament', { id: item.id })
          .then(() => {
            this.load();
            wx.showToast({ title: '积分结算中…', icon: 'none', duration: 2000 });
            return settleUntilDone(item.id, {
              onProgress: (progress) => wx.showToast({
                title: '积分结算中 ' + (Number(progress.appliedEntries) || 0) + '/' + (Number(progress.participantCount) || 0),
                icon: 'none',
                duration: 2000,
              }),
            }).catch((err) => {
              // 归档已经成功，结算没跑完不能让用户误以为归档失败
              wx.showToast({ title: '赛事已归档，积分待补算：' + (err.message || '服务暂不可用'), icon: 'none' });
              return null;
            });
          })
          .then((result) => {
            if (result) wx.showToast({ title: '已归档并结算积分', icon: 'success' });
          })
          .catch((err) => wx.showToast({ title: err.message || '归档失败', icon: 'none' }));
      },
    });
  },

  deleteToday(index) {
    const item = this.data.today[Number(index)];
    if (!item || !item.canDelete) return;
    const id = String(item.id || item._id || '');
    if (!id) {
      wx.showToast({ title: '赛事编号缺失，请刷新后重试', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除确认',
      content: '「' + item.name + '」及其报名、选人和赛程数据将被删除，确定继续？',
      confirmText: '确认删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (!res.confirm) return;
        api
          .call('deleteTournament', { id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            return this.load();
          })
          .catch((err) => wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' }));
      },
    });
  },

  onSwipeStart(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = this.data.today[index];
    if (!item || !item.canDelete) return;
    this._swipeStartX = e.touches[0].clientX;
    this._swipeStartY = e.touches[0].clientY;
    this._swipeIndex = index;
    this._swipeDirection = '';
    this._swipeMoved = false;
  },

  onSwipeMove(e) {
    const index = this._swipeIndex;
    if (index == null) return;
    const item = this.data.today[index];
    if (!item) return;
    const dx = e.touches[0].clientX - this._swipeStartX;
    const dy = e.touches[0].clientY - this._swipeStartY;
    if (!this._swipeDirection && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      this._swipeDirection = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (this._swipeDirection === 'vertical') {
        this._swipeIndex = null;
        return;
      }
      this.setData({ ['today[' + index + '].swipeDragging']: true });
    }
    if (this._swipeDirection !== 'horizontal') return;
    const maxSwipe = (item.champion ? 280 : 140) * (this._rpxScale || 0.5);
    const wasOpen = item.swipeOpen;
    const base = wasOpen ? -maxSwipe : 0;
    let x = base + dx;
    if (x > 0) x = 0;
    if (x < -maxSwipe) x = -maxSwipe;
    this._swipeMoved = true;
    this.setData({ ['today[' + index + '].swipeX']: x });
  },

  onSwipeEnd() {
    const index = this._swipeIndex;
    if (index == null) {
      this._swipeDirection = '';
      this._swipeMoved = false;
      return;
    }
    const item = this.data.today[index];
    const maxSwipe = (item && item.champion ? 280 : 140) * (this._rpxScale || 0.5);
    const x = item ? item.swipeX : 0;
    const open = x < -maxSwipe / 2;
    const patches = {
      ['today[' + index + '].swipeX']: open ? -maxSwipe : 0,
      ['today[' + index + '].swipeOpen']: open,
      ['today[' + index + '].swipeDragging']: false,
    };
    this.data.today.forEach((it, i) => {
      if (i !== index && it.swipeOpen) {
        patches['today[' + i + '].swipeX'] = 0;
        patches['today[' + i + '].swipeOpen'] = false;
      }
    });
    if (this._swipeMoved) this._blockCardTapUntil = Date.now() + 300;
    this.setData(patches);
    this._swipeIndex = null;
    this._swipeDirection = '';
    this._swipeMoved = false;
  },

  onSwipeAction(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const index = Number(e.currentTarget.dataset.index);
    const action = e.currentTarget.dataset.action;
    const item = this.data.today[index];
    if (!item || !item.canDelete) return;
    // 先收起卡片
    this.setData({ ['today[' + index + '].swipeX']: 0, ['today[' + index + '].swipeOpen']: false });
    if (action === 'archive') {
      this.archiveToday(index);
    } else if (action === 'delete') {
      this.deleteToday(index);
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
