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

// 规则页分值表：分值即展示分（与后端 SCORE_UNITS 一致），负分标红，“—”表示该队数没有这个名次。
function buildScoreTable(title, rows) {
  return {
    title,
    columns: ['4 队', '8 队', '16 队'],
    rows: rows.map((entry, rowIndex) => ({
      label: entry[0],
      total: entry[0] === '合计',
      cells: entry.slice(1).map((text, cellIndex) => ({
        key: rowIndex + '-' + cellIndex,
        text,
        negative: String(text).charAt(0) === '−',
      })),
    })),
  };
}

// 名片上的名次荣誉：固定三段，没拿过也写 0，例如「0 冠 2 亚 4 季」，保证所有名片第二排格式一致
function formatHonors(honors) {
  const source = honors || {};
  const champions = Number(source.champions) || 0;
  const runnersUp = Number(source.runnersUp) || 0;
  const thirds = Number(source.thirds) || 0;
  return champions + ' 冠 ' + runnersUp + ' 亚 ' + thirds + ' 季';
}

// 页码条：页数少时全部列出，页数多时只留首页、末页和当前页附近，中间用「…」占位。
function buildPageItems(page, totalPages) {
  const items = [];
  const pushPage = (value) => items.push({ key: 'p' + value, label: String(value), page: value, active: value === page });
  if (totalPages <= 7) {
    for (let value = 1; value <= totalPages; value += 1) pushPage(value);
    return items;
  }
  const windowStart = Math.max(2, page - 1);
  const windowEnd = Math.min(totalPages - 1, page + 1);
  pushPage(1);
  if (windowStart > 2) items.push({ key: 'gap-start', label: '…', page: 0, active: false });
  for (let value = windowStart; value <= windowEnd; value += 1) pushPage(value);
  if (windowEnd < totalPages - 1) items.push({ key: 'gap-end', label: '…', page: 0, active: false });
  pushPage(totalPages);
  return items;
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
      honorsText: formatHonors(item.honors),
      player: item.player || { openid: '', nickname: String(item.nickname || '玩家'), mmr: item.mmr },
    })),
    leaderboardPage: {
      page,
      pageSize,
      totalPages,
      canPrev: page > 1,
      canNext: page < totalPages,
      pageText: '第 ' + page + ' / ' + totalPages + ' 页',
      pageItems: buildPageItems(page, totalPages),
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
    leaderboardPage: { page: 1, pageSize: 10, totalPages: 1, canPrev: false, canNext: false, pageText: '第 1 / 1 页', pageItems: [], summaryText: '' },
    records: [],
    activeTab: 'leaderboard',
    loading: true,
    hasLoaded: false,
    loadError: '',
    scoreRules: [
      buildScoreTable('单败 / 双败（含历史赛事）', [
        ['冠军', '+60', '+120', '+200'],
        ['亚军', '+35', '+70', '+120'],
        ['季军与第 4 名', '+15', '+40', '+75'],
        ['其余队伍', '无', '+15', '+20'],
        ['合计', '+125', '+340', '+710'],
      ]),
      buildScoreTable('单败排位赛', [
        ['冠军', '+60', '+120', '+200'],
        ['亚军', '+35', '+75', '+125'],
        ['季军', '+25', '+55', '+90'],
        ['第 4 名', '+15', '+40', '+65'],
        ['第 5 名（并列）', '—', '+25', '+45'],
        ['第 6 名（并列）', '—', '+15', '+30'],
        ['第 9 名（并列）', '—', '—', '+20'],
        ['第 10 名（并列）', '—', '—', '+10'],
        ['合计', '+135', '+370', '+750'],
      ]),
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

  // 直接点页码跳页：与上一页 / 下一页 共用同一套加载和请求去重
  onLeaderboardPageTap(event) {
    const target = Number(event.currentTarget.dataset.page) || 0;
    const board = this.data.leaderboardPage || {};
    if (!target || target < 1 || target > (Number(board.totalPages) || 1)) return;
    if (target === (Number(board.page) || 1)) return;
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
