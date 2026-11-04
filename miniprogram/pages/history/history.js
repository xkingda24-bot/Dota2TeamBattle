// pages/history/history.js - 历史比赛（列表 + 详情）
const api = require('../../utils/api');
const { getTodayBoundary } = require('../../utils/date-time');

const BO_LIST = ['BO1', 'BO3', 'BO5'];

function readCardStyles(teams) {
  const openids = [];
  (teams || []).forEach((team) => {
    [team.captain].concat(team.players || []).forEach((member) => {
      const openid = typeof member === 'string' ? member : member && member.openid;
      if (typeof openid === 'string' && openid && openids.indexOf(openid) < 0) openids.push(openid);
    });
  });
  if (!openids.length) return Promise.resolve({});

  const batches = [];
  for (let index = 0; index < openids.length; index += 100) batches.push(openids.slice(index, index + 100));
  return Promise.all(batches.map((batch) =>
    api.call('getCardStyles', { openids: batch }).catch(() => ({ cardStyles: {} }))
  )).then((results) => results.reduce((all, result) => Object.assign(all, result.cardStyles || {}), {}));
}

function buildTeamRosters(teams, registrations, cardStyles) {
  const registrationMap = {};
  (registrations || []).forEach((registration) => {
    if (registration && registration.openid) registrationMap[registration.openid] = registration;
  });
  const formatRoles = (roles) =>
    Array.isArray(roles) && roles.length ? roles.map((role) => role + '号位').join('、') : '';
  const buildMember = (rawMember, isCaptain) => {
    if (!rawMember) return null;
    const rawOpenid = typeof rawMember === 'string' ? rawMember : rawMember.openid;
    const registration = rawOpenid ? registrationMap[rawOpenid] : null;
    const member = typeof rawMember === 'string'
      ? registration || { openid: rawMember }
      // Prefer the composed registration profile so rank, score, roles, signature,
      // and nickname stay current if an older team snapshot has stale card data.
      : Object.assign({}, rawMember, registration || {});
    const openid = member.openid || rawOpenid || '';
    return Object.assign({}, member, {
      openid,
      nickname: member.nickname || (isCaptain ? '队长' : '队员'),
      rolesText: member.rolesText || formatRoles(member.roles),
      cardStyle: cardStyles[openid] || member.cardStyle || null,
      isCaptain,
    });
  };

  return (teams || []).map((team, teamIndex) => {
    const captain = buildMember(team.captain, true);
    const players = (team.players || []).map((player) => buildMember(player, false)).filter(Boolean);
    const members = (captain ? [captain] : []).concat(players);
    return Object.assign({}, team, {
      teamIndex,
      captain,
      players,
      members,
      displayName: captain ? captain.nickname + '战队' : '队' + (teamIndex + 1),
    });
  });
}

Page({
  data: {
    mode: 'list', // list | detail
    loading: true,
    loadError: '',
    canManage: false,
    deletingId: '',
    older: [],
    t: null,
    ubMatches: [],
    lbMatches: [],
    gf: null,
  },

  onLoad(options) {
    if (options && options.id) {
      this.id = options.id;
      this.setData({ mode: 'detail' });
    } else {
      this.id = '';
      this.setData({ mode: 'list' });
    }
  },

  onShow() {
    this.load();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, loadError: '' });
    if (this.data.mode === 'detail') return this.loadDetail();
    return this.loadList();
  },

  loadList() {
    this.setData({ loading: true, loadError: '' });
    const now = new Date();
    const todayStart = getTodayBoundary(now);
    return api
      .call('home', { todayStart })
      .then((d) => {
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
        this.setData({ older, canManage: false, loading: false });
      })
      .catch((e) => {
        this.setData({ loading: false, loadError: e.message || '历史赛事加载失败' });
      });
  },

  loadDetail() {
    this.setData({ loading: true, loadError: '' });
    return api
      .call('tournament', { id: this.id })
      .then((t) => {
        const teams = Array.isArray(t.teams) ? t.teams : [];
        return readCardStyles(teams).then((cardStyles) => {
          const matches = (t.matches || []).map((m) =>
            Object.assign({}, m, { boIndex: Math.max(0, BO_LIST.indexOf(m.bo)) })
          );
          this.setData({
            t: Object.assign({}, t, {
              teams: buildTeamRosters(teams, t.registrations, cardStyles),
            }),
            canManage: !!t.canManage,
            ubMatches: matches.filter((m) => m.stage === 'upper' || (m.stage || '').indexOf('UB') === 0),
            lbMatches: matches.filter((m) => m.stage === 'lower' || (m.stage || '').indexOf('LB') === 0),
            gf: matches.find((m) => m.isChampionMatch) || null,
            loading: false,
          });
        });
      })
      .catch((e) => {
        this.setData({ loading: false, t: null, loadError: e.message || '比赛详情加载失败' });
      });
  },

  goDetail(e) {
    const item = this.data.older[e.currentTarget.dataset.index];
    if (!item) return;
    this.id = item.id;
    this.setData({ mode: 'detail' });
    this.loadDetail();
  },

  backList() {
    this.id = '';
    this.setData({ mode: 'list', t: null, loadError: '' });
    this.loadList();
  },

  retryLoad() {
    this.load();
  },

  deleteFromHistory(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (this.data.deletingId) return;
    const data = e.currentTarget.dataset || {};
    const item = data.index !== undefined ? this.data.older[Number(data.index)] : null;
    if (!(item ? item.canDelete : this.data.t && this.data.t.canDelete)) return;
    // 兼容旧版云函数返回 `_id`，避免取不到赛事编号后静默退出。
    const id = String(data.id || (item && (item.id || item._id)) || (this.data.t && (this.data.t.id || this.data.t._id)) || '');
    const name = (item && item.name) || (this.data.t && this.data.t.name) || '本场比赛';
    if (!id) {
      wx.showToast({ title: '赛事编号缺失，请刷新后重试', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除确认',
      content: '「' + name + '」及其比赛数据将被删除，确定继续？',
      confirmText: '确认删除',
      confirmColor: '#e5484d',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ deletingId: id });
        api.call('deleteTournament', { id })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            if (this.data.mode === 'detail') {
              this.id = '';
              this.setData({ mode: 'list', t: null });
            }
            return this.loadList();
          })
          .catch((error) => wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' }))
          .finally(() => this.setData({ deletingId: '' }));
      },
    });
  },

  // 查看晋级图（只读模式：不支持修改）
  goTree() {
    if (!this.id) return;
    wx.navigateTo({ url: '/pages/bracket/bracket?id=' + this.id + '&readonly=1' });
  },
});
