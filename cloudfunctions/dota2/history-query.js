/**
 * 历史赛事查询参数归一化（不依赖数据库，便于单测）。
 *
 * 分页用 createdAt 游标，不用 skip：历史越多、被过滤的已删/已结算记录越多，
 * skip 的翻页成本会线性增长；游标查询每一页只读一页数据。
 */
const { getSeasonById } = require('./season-window');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_KEYWORD = 30;

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeHistoryQuery(options) {
  const opts = options || {};
  const rawLimit = Number(opts.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const todayStart = Number(opts.todayStart) || 0;
  const cursorCreatedAt = Number(opts.cursorCreatedAt) || 0;
  const cursorId = String(opts.cursorId || '').trim();
  const keyword = String(opts.keyword || '').trim().slice(0, MAX_KEYWORD);
  const seasonId = String(opts.seasonId || '').trim();

  let season = null;
  if (seasonId) {
    season = getSeasonById(seasonId);
    if (!season) {
      const error = new Error('未知赛季：' + seasonId);
      error.code = 'UNKNOWN_SEASON';
      throw error;
    }
  }

  return {
    limit,
    todayStart,
    cursorCreatedAt,
    cursorId,
    keyword,
    regexp: keyword ? escapeRegExp(keyword) : '',
    seasonId: season ? season.seasonId : '',
    season: season ? { startAt: season.startAt, endAt: season.endAt } : null,
  };
}

/*
 * 结算状态标注：只有赛季结算记录 status === 'settled' 才算真正结算完成。
 * 已归档但没跑过结算（无记录）、结算中断（processing）、结算失败（failed）都算未结算。
 */
function applySettlementStates(items, states) {
  const source = Array.isArray(items) ? items : [];
  const map = states || {};
  return source.map((item) => {
    const id = String((item && (item.id || item._id)) || '');
    const status = String(map[id] || '');
    return Object.assign({}, item, {
      settlementStatus: status,
      settled: status === 'settled',
    });
  });
}

module.exports = { DEFAULT_LIMIT, MAX_LIMIT, MAX_KEYWORD, describeHistoryQuery, escapeRegExp, applySettlementStates };
