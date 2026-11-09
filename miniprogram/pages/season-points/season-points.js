const api = require('../../utils/api');

const SEASONS = [
  { code: '2026Q1', short: 'Q1', label: '2026 Q1', period: '1月 1日 — 3月 31日' },
  { code: '2026Q2', short: 'Q2', label: '2026 Q2', period: '4月 1日 — 6月 30日' },
  { code: '2026Q3', short: 'Q3', label: '2026 Q3', period: '7月 1日 — 9月 30日' },
  { code: '2026Q4', short: 'Q4', label: '2026 Q4', period: '10月 1日 — 12月 31日' },
];

function formatPoints(value) {
  const points = Number(value) || 0;
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

function formatDelta(value) {
  const points = Number(value) || 0;
  if (points > 0) return '+' + formatPoints(points);
  if (points < 0) return '−' + formatPoints(Math.abs(points));
  return '0';
}

function formatDate(timestamp) {
  const date = new Date((Number(timestamp) || 0) + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '日期待补充';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return date.getUTCFullYear() + '-' + month + '-' + day;
}

function seasonStatusText(status) {
  if (status === 'active') return '进行中';
  if (status === 'upcoming') return '未开始';
  return '已结束';
}

function buildSeasonView(data, fallbackSeasonId) {
  const seasonData = data && data.season || {};
  const seasonId = String(seasonData.seasonId || fallbackSeasonId || '2026Q4');
  const season = SEASONS.find((item) => item.code === seasonId) || SEASONS[3];
  const me = data && data.me || {};
  const leaderboard = Array.isArray(data && data.leaderboard) ? data.leaderboard : [];
  const records = Array.isArray(data && data.records) ? data.records : [];
  const seasonSummaries = Array.isArray(data && data.seasons) ? data.seasons : [];
  const seasonStatusByCode = new Map(seasonSummaries.map((item) => [item.code, item.status]));
  const boardPage = data && data.leaderboardPage || {};
  const totalPages = Math.max(1, Number(boardPage.totalPages) || 1);
  const page = Math.min(Math.max(Number(boardPage.page) || 1, 1), totalPages);
  const pageSize = Math.max(1, Number(boardPage.pageSize) || 10);
  return {
    seasons: SEASONS.map((item) => Object.assign({}, item, {
      status: seasonStatusText(seasonStatusByCode.get(item.code)),
    })),
    selectedSeason: seasonId,
    seasonLabel: seasonData.displayName || season.label,
    seasonPeriod: season.period,
    seasonStatus: seasonStatusText(seasonData.status),
    myPoints: formatPoints(me.points),
    myRank: me.rank || null,
    myRankText: me.rank ? '#' + me.rank : '未上榜',
    totalPlayers: Number(me.totalPlayers) || 0,
    completedMatches: Number(me.settledMatches) || 0,
    myNickname: String(me.nickname || '未设置昵称'),
    mmr: me.mmr == null ? '—' : String(me.mmr),
    showMyRankRow: !me.rank || Number(me.rank) > 3,
    // 积分榜每条渲染成玩家名片，服务端按 10 条一页返回
    leaderboard: leaderboard.map((item, index) => ({
      seq: (page - 1) * pageSize + index + 1,
      place: item.rank,
      isMine: !!item.isMine,
      player: item.player || { openid: '', nickname: String(item.nickname || '玩家'), mmr: item.mmr },
    })),
    leaderboardPage: {
      page,
      pageSize,
      totalPages,
      canPrev: page > 1,
      canNext: page < totalPages,
      pageText: '第 ' + page + ' / ' + totalPages + ' 页',
      summaryText: '共 ' + (Number(boardPage.totalPlayers) || Number(me.totalPlayers) || 0) + ' 位玩家 · 每页 ' + pageSize + ' 人',
    },
    records: records.map((item) => ({
      date: formatDate(item.date),
      title: String(item.title || '赛事结算'),
      detail: String(item.detail || '赛事结算'),
      delta: formatDelta(item.delta),
      negative: Number(item.delta) < 0,
    })),
  };
}

Page({
  data: {
    seasons: SEASONS,
    selectedSeason: '2026Q4',
    seasonLabel: '2026 Q4',
    seasonPeriod: '10月 1日 — 12月 31日',
    seasonStatus: '进行中',
    myPoints: '0',
    myRank: null,
    myRankText: '未上榜',
    totalPlayers: 0,
    completedMatches: 0,
    myNickname: '未设置昵称',
    mmr: '—',
    showMyRankRow: true,
    leaderboard: [],
    leaderboardPage: { page: 1, pageSize: 10, totalPages: 1, canPrev: false, canNext: false, pageText: '第 1 / 1 页', summaryText: '' },
    records: [],
    activeTab: 'leaderboard',
    loading: true,
    hasLoaded: false,
    loadError: '',
    scoreRules: [
      { teams: '4 队', champion: '+45', runnerUp: '+5', third: '−25', others: '无' },
      { teams: '8 队', champion: '+100', runnerUp: '+60', third: '+30', others: '−55' },
      { teams: '16 队', champion: '+127.5', runnerUp: '+87.5', third: '+57.5', others: '−27.5' },
    ],
  },

  // 转发给好友：榜单本身可公开浏览，固定入口不带参数
  onShareAppMessage() {
    return {
      title: '刀塔集结 · ' + (this.data.seasonLabel || '赛季积分') + ' 积分榜',
      path: '/pages/season-points/season-points',
    };
  },

  onShow() {
    const seasonId = this._seasonInitialized ? this.data.selectedSeason : '';
    this._seasonInitialized = true;
    this.loadSeasonPage(seasonId);
  },

  loadSeasonPage(seasonId, page) {
    const requestId = (this._seasonRequestId || 0) + 1;
    this._seasonRequestId = requestId;
    this.setData({ loading: true, loadError: '' });
    return api.callFunction('seasonPoints', 'getSeasonPage', { seasonId, page: Math.max(1, Number(page) || 1) })
      .then((result) => {
        if (requestId !== this._seasonRequestId) return;
        this.setData(Object.assign({ loading: false, hasLoaded: true, loadError: '' }, buildSeasonView(result, seasonId)));
      })
      .catch((error) => {
        if (requestId !== this._seasonRequestId) return;
        this.setData({ loading: false, hasLoaded: false, loadError: error.message || '赛季积分暂时无法加载' });
      });
  },

  retryLoad() {
    this.loadSeasonPage(this.data.selectedSeason, this.data.leaderboardPage.page);
  },

  onLeaderboardPage(event) {
    const direction = Number(event.currentTarget.dataset.dir) || 0;
    const board = this.data.leaderboardPage || {};
    const target = (Number(board.page) || 1) + direction;
    if (!direction || target < 1 || target > (Number(board.totalPages) || 1)) return;
    this.loadSeasonPage(this.data.selectedSeason, target);
  },

  onSelectSeason(event) {
    const code = String(event.currentTarget.dataset.season || '');
    if (!SEASONS.some((item) => item.code === code) || code === this.data.selectedSeason) return;
    this.setData({ selectedSeason: code, activeTab: 'leaderboard', leaderboard: [], records: [] });
    this.loadSeasonPage(code);
  },

  onSelectTab(event) {
    const tab = String(event.currentTarget.dataset.tab || 'leaderboard');
    if (['leaderboard', 'records', 'rules'].indexOf(tab) < 0) return;
    this.setData({ activeTab: tab });
  },
});
