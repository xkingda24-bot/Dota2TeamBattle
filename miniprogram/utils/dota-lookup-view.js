const { formatDateTime } = require('./date-time');
const { dotaHeroName } = require('./dota-heroes');
const {
  RANK_VERIFICATION_TTL,
  normalizeRankTier,
  dotaRankLabel,
  leaderboardRank,
  estimateMmrFromRankTier,
} = require('./dota-rank');

function buildDotaLookupView(result) {
  const source = result || {};
  const verifiedAt = Number(source.verifiedAt) || Date.now();
  const validUntil = verifiedAt + RANK_VERIFICATION_TTL;
  const rankTier = normalizeRankTier(source.rankTier);
  const recent = source.recentStats || {};
  const total = Math.max(0, Number(recent.total) || 0);
  const kda = Number(recent.kda);
  const commonHeroes = Array.isArray(source.commonHeroes) ? source.commonHeroes : [];

  return Object.assign({}, source, {
    accountId: String(source.accountId || ''),
    nickname: String(source.nickname || '').trim() || '未知玩家',
    avatarUrl: String(source.avatarUrl || '').trim(),
    rankTier,
    rankLabel: dotaRankLabel(rankTier),
    leaderboardRank: leaderboardRank(source, true),
    estimatedMmr: estimateMmrFromRankTier(rankTier),
    recentRecordText: total > 0
      ? '近 ' + total + ' 场 · ' + (Number(recent.wins) || 0) + ' 胜 ' + (Number(recent.losses) || 0) + ' 负'
      : '暂无近期公开比赛',
    recentKdaText: total > 0 && Number.isFinite(kda) ? kda.toFixed(2) : '—',
    commonHeroesText: commonHeroes.length
      ? commonHeroes.map((hero) => dotaHeroName(hero.heroId, hero.name) + '（' + (Number(hero.games) || 0) + ' 场）').join(' · ')
      : '暂无公开数据',
    verifiedAt,
    verifiedAtText: formatDateTime(verifiedAt),
    validUntil,
    validUntilText: formatDateTime(validUntil),
    isExpired: Date.now() >= validUntil,
  });
}

module.exports = { buildDotaLookupView };
