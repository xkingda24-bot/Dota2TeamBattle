// pages/profile-edit/profile-edit.js - 资料编辑（独立页面，原 staff 弹窗迁移）
const api = require('../../utils/api');
const { formatDateTime } = require('../../utils/date-time');
const { hasCurrentRankVerification, rankVerifiedAt, normalizeRankTier, dotaRankLabel, leaderboardRank, estimateMmrFromRankTier } = require('../../utils/dota-rank');
const { buildDotaLookupView } = require('../../utils/dota-lookup-view');

function rankLabelFor(user, verified) {
  if (!verified) return '未校验段位';
  const label = dotaRankLabel(user.dota2RankTier);
  return label === '未知段位' ? '未校验段位' : label;
}

Page({
  data: {
    user: null,
    pageLoading: true,
    pageError: '',
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
  },

  onLoad() {
    this.bootstrap();
  },

  onUnload() {
    // 页面销毁后未完成的段位校验响应不再写回
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
  },

  bootstrap() {
    this.setData({ pageLoading: true, pageError: '' });
    return api
      .call('getStaff')
      .then((d) => {
        this.setData({ user: d.user || null, pageLoading: false });
        this.initProfileForm();
      })
      .catch((e) => {
        this.setData({ pageLoading: false, pageError: e.message || '加载失败，请重试' });
      });
  },

  retryBootstrap() {
    this.bootstrap();
  },

  /* 读取当前资料初始化表单；老资料没有快照时自动补一次段位校验 */
  initProfileForm() {
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
    const initialEstimatedMmr = !hasRankVerification
      ? null
      : savedLookup
        ? savedLookup.estimatedMmr
        : Number(u.dota2RankTier) === 80
          ? null
          : estimateMmrFromRankTier(u.dota2RankTier);
    const rolesActive = [false, false, false, false, false];
    roles.forEach((v) => (rolesActive[v - 1] = true));
    this.setData({
      pf: {
        nickname: u.nickname || '',
        mmr: u.mmr === null || u.mmr === undefined || u.mmr === '' ? '' : String(u.mmr),
        dota2Id: String(u.dota2Id || ''),
        dotaRankVerified: hasRankVerification,
        dota2RankLabel: rankLabelFor(u, hasRankVerification),
        dota2EstimatedMmr: initialEstimatedMmr,
        dota2RankTier: hasRankVerification ? Number(u.dota2RankTier) : null,
        dota2LeaderboardRank: leaderboardRank(u, hasRankVerification),
        dota2RankVerifiedAt: verifiedAt || null,
        dotaRankVerifiedAtText: verifiedAt ? formatDateTime(verifiedAt) : '',
        dotaRankConfirmed: false,
        originalDota2Id: String(u.dota2Id || ''),
        originalDotaRankVerified: hasRankVerification,
        originalRankLabel: hasRankVerification ? rankLabelFor(u, true) : '',
        originalRankTier: hasRankVerification ? Number(u.dota2RankTier) : null,
        originalEstimatedMmr: initialEstimatedMmr,
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
    // 老资料没有快照时自动补一次校验；保存后再次进入会直接使用快照。
    if (!savedLookup && String(u.dota2Id || '')) this.onLookupDota();
  },

  goBack() {
    if (this.data.saving) return;
    this._rankLookupRequestId = (this._rankLookupRequestId || 0) + 1;
    this.setData({ lookingUpDota: false });
    wx.navigateBack({ delta: 1 });
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
        'pf.dota2EstimatedMmr': this.data.pf.originalEstimatedMmr,
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
            'pf.originalEstimatedMmr': rankResult.estimatedMmr,
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
        this.setData({ saving: false });
        wx.showToast({ title: '已保存', icon: 'success' });
        // 返回“我的”，staff onShow 会自动重新加载资料与名片
        wx.navigateBack({ delta: 1 });
      })
      .catch((err) => {
        this.setData({ saving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },
});
