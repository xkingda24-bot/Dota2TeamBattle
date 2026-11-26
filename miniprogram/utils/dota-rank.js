const RANK_VERIFICATION_TTL = 7 * 24 * 60 * 60 * 1000;
const DOTA_ID_RE = /^\d{5,12}$/;

function normalizeRankTier(value) {
  if (value === null || value === undefined || value === '') return null;
  const rank = Number(value);
  if (!Number.isInteger(rank)) return null;
  if (rank === 80) return rank;
  const major = Math.floor(rank / 10);
  const stars = rank % 10;
  return major >= 1 && major <= 7 && stars >= 1 && stars <= 5 ? rank : null;
}

function dotaRankLabel(rankTier) {
  const rank = normalizeRankTier(rankTier);
  if (rank === null) return '未知段位';
  if (rank === 80) return '冠绝';
  const names = { 1: '先锋', 2: '卫士', 3: '中军', 4: '统帅', 5: '传奇', 6: '万古', 7: '超凡' };
  return names[Math.floor(rank / 10)] + (rank % 10);
}

// 按社区段位表估算当前星级的起始 MMR；资料表单最低允许 1 分。
function estimateMmrFromRankTier(rankTier) {
  const rank = normalizeRankTier(rankTier);
  if (rank === null) return null;
  if (rank === 80) return 5620;
  const major = Math.floor(rank / 10);
  const stars = rank % 10;
  const base = (major - 1) * 770;
  const starMmr = major === 7 ? 200 : 154;
  return Math.max(1, base + (stars - 1) * starMmr);
}

// 冠绝名次仅用于粗略展示，不是官方分数换算；后续可按赛季样本调整。
function estimateImmortalMmrRange(rank) {
  const position = Number(rank);
  if (!Number.isInteger(position) || position < 1) return null;
  if (position <= 100) return { min: 8500, max: 9500, estimate: 9000 };
  if (position <= 500) return { min: 7500, max: 8500, estimate: 8000 };
  if (position <= 1000) return { min: 6800, max: 7500, estimate: 7150 };
  if (position <= 2000) return { min: 6000, max: 6800, estimate: 6400 };
  return { min: 5620, max: 6000, estimate: 5810 };
}

function dotaRankDisplayLabel(player, verified) {
  const source = player || {};
  const rankTier = normalizeRankTier(source.dota2RankTier !== undefined ? source.dota2RankTier : source.rankTier);
  const label = dotaRankLabel(rankTier);
  const position = leaderboardRank(source, verified);
  return rankTier === 80 && position ? label + '(' + position + '名)' : label;
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1e11 ? numeric * 1000 : numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rankVerifiedAt(player) {
  return toTimestamp(player && (player.dota2RankVerifiedAt || player.dota2VerifiedAt));
}

function hasCurrentRankVerification(player, now) {
  if (!player || player.dota2RankVerified === false || !DOTA_ID_RE.test(String(player.dota2Id || '').trim())) return false;
  if (normalizeRankTier(player.dota2RankTier) === null) return false;
  const verifiedAt = rankVerifiedAt(player);
  const currentTime = Number(now) || Date.now();
  const age = currentTime - verifiedAt;
  return verifiedAt > 0 && age >= 0 && age < RANK_VERIFICATION_TTL;
}

function leaderboardRank(player, verified) {
  if (!verified || !player) return null;
  const raw = player.dota2LeaderboardRank !== undefined
    ? player.dota2LeaderboardRank
    : player.leaderboardRank !== undefined
      ? player.leaderboardRank
      : player.leaderboard_rank;
  if (raw === null || raw === undefined || raw === '') return null;
  const rank = Number(raw);
  return Number.isInteger(rank) && rank >= 1 && rank <= 10000 ? rank : null;
}

module.exports = {
  RANK_VERIFICATION_TTL,
  normalizeRankTier,
  dotaRankLabel,
  dotaRankDisplayLabel,
  estimateMmrFromRankTier,
  estimateImmortalMmrRange,
  toTimestamp,
  rankVerifiedAt,
  hasCurrentRankVerification,
  leaderboardRank,
};
