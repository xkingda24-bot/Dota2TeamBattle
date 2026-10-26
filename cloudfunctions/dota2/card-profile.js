const RANK_VERIFICATION_TTL = 14 * 24 * 60 * 60 * 1000;
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
  if (rank === null) return Number(rankTier) === 0 ? '未定级' : '未知段位';
  if (rank === 80) return '冠绝';

  const names = {
    1: '先锋',
    2: '卫士',
    3: '中军',
    4: '统帅',
    5: '传奇',
    6: '万古',
    7: '超凡',
  };
  const major = Math.floor(rank / 10);
  const stars = rank % 10;
  return names[major] + stars;
}

function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    // Accept seconds as well as milliseconds for legacy/imported profile records.
    return numeric > 0 && numeric < 1e11 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rankVerifiedAt(source) {
  if (!source) return null;
  const current = toTimestamp(source.dota2RankVerifiedAt);
  if (current !== null) return current;
  // Older profiles used the same timestamp for the Dota ID/MMR lookup.
  return toTimestamp(source.dota2VerifiedAt);
}

function isRankVerified(source, now) {
  if (!source || source.dota2RankVerified === false) return false;
  const dota2Id = String(source.dota2Id || '').trim();
  if (!DOTA_ID_RE.test(dota2Id)) return false;
  if (normalizeRankTier(source.dota2RankTier) === null) return false;

  const verifiedAt = rankVerifiedAt(source);
  const currentTime = now === undefined ? Date.now() : Number(now);
  if (verifiedAt === null || !Number.isFinite(currentTime)) return false;
  const age = currentTime - verifiedAt;
  return age >= 0 && age < RANK_VERIFICATION_TTL;
}

function normalizeLeaderboardRank(source) {
  if (!source) return null;
  const raw = source.dota2LeaderboardRank !== undefined
    ? source.dota2LeaderboardRank
    : source.leaderboardRank !== undefined
      ? source.leaderboardRank
      : source.leaderboard_rank;
  if (raw === null || raw === undefined || raw === '') return null;
  const rank = Number(raw);
  return Number.isInteger(rank) && rank >= 1 && rank <= 10000 ? rank : null;
}

function publicDotaCardFields(mmr, snapshot, currentProfile, now) {
  // Prefer the registration snapshot when its rank proof is current; otherwise
  // use the latest profile. Rank verification is intentionally independent of MMR.
  const verifiedSource = isRankVerified(snapshot, now)
    ? snapshot
    : isRankVerified(currentProfile, now)
      ? currentProfile
      : null;
  const verifiedAt = verifiedSource ? rankVerifiedAt(verifiedSource) : null;
  const rankTier = verifiedSource ? normalizeRankTier(verifiedSource.dota2RankTier) : null;
  const leaderboardRank = verifiedSource ? normalizeLeaderboardRank(verifiedSource) : null;

  return {
    dota2RankVerified: !!verifiedSource,
    dota2Id: verifiedSource ? String(verifiedSource.dota2Id).trim() : '',
    dota2RankTier: rankTier,
    dota2RankLabel: verifiedSource ? dotaRankLabel(rankTier) : '',
    dota2LeaderboardRank: leaderboardRank,
    dota2RankVerifiedAt: verifiedAt,
  };
}

module.exports = {
  RANK_VERIFICATION_TTL,
  dotaRankLabel,
  isRankVerified,
  publicDotaCardFields,
};
