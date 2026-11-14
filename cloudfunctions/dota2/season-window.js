/**
 * 赛季时间窗口。
 *
 * 与积分云函数 seasonPoints/core.js 的 SEASONS 保持同一口径：
 * 归档时间落在哪个季度，就归属哪个赛季；东八区零点为界。
 * 历史赛事列表按赛季筛选时复用这里的区间，避免两套时间定义漂移。
 */
const SEASONS = [
  { seasonId: '2026Q1', label: '2026 Q1', startAt: Date.parse('2026-01-01T00:00:00+08:00'), endAt: Date.parse('2026-04-01T00:00:00+08:00') },
  { seasonId: '2026Q2', label: '2026 Q2', startAt: Date.parse('2026-04-01T00:00:00+08:00'), endAt: Date.parse('2026-07-01T00:00:00+08:00') },
  { seasonId: '2026Q3', label: '2026 Q3', startAt: Date.parse('2026-07-01T00:00:00+08:00'), endAt: Date.parse('2026-10-01T00:00:00+08:00') },
  { seasonId: '2026Q4', label: '2026 Q4', startAt: Date.parse('2026-10-01T00:00:00+08:00'), endAt: Date.parse('2027-01-01T00:00:00+08:00') },
];

function getSeasonById(seasonId) {
  const id = String(seasonId || '').trim();
  if (!id) return null;
  return SEASONS.find((season) => season.seasonId === id) || null;
}

function seasonOfTimestamp(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  return SEASONS.find((season) => value >= season.startAt && value < season.endAt) || null;
}

/* 供前端渲染赛季筛选 chips：只暴露 id 与文案，不下发时间戳细节。 */
function listSeasonOptions() {
  return SEASONS.map((season) => ({ seasonId: season.seasonId, label: season.label }));
}

module.exports = { SEASONS, getSeasonById, seasonOfTimestamp, listSeasonOptions };
