const { formatDateTime } = require('./date-time');
const { dotaHeroName } = require('./dota-heroes');
const { hasMissingPublicData } = require('./dota-public-data');
const {
  RANK_VERIFICATION_TTL,
  normalizeRankTier,
  dotaRankLabel,
  dotaRankDisplayLabel,
  leaderboardRank,
  estimateMmrFromRankTier,
  estimateImmortalMmrRange,
} = require('./dota-rank');

function buildMmrEstimate(source, rankTier, rankPosition) {
  if (rankTier !== 80) {
    const estimatedMmr = estimateMmrFromRankTier(rankTier);
    return {
      estimatedMmr,
      estimatedMmrText: estimatedMmr === null ? '—' : estimatedMmr + ' 分',
      estimateLabel: '预估分',
      canUseEstimatedMmr: estimatedMmr !== null,
    };
  }
  const openDotaEstimate = Number(source.mmrEstimate);
  if (Number.isFinite(openDotaEstimate) && openDotaEstimate >= 1 && openDotaEstimate <= 20000) {
    const estimatedMmr = Math.round(openDotaEstimate);
    return {
      estimatedMmr,
      estimatedMmrText: '约 ' + estimatedMmr + ' 分',
      estimateLabel: 'OpenDota 预估',
      canUseEstimatedMmr: true,
    };
  }
  const range = estimateImmortalMmrRange(rankPosition);
  if (range) {
    return {
      estimatedMmr: range.estimate,
      estimatedMmrText: '约 ' + range.min + '–' + range.max + ' 分',
      estimateLabel: '名次粗略预估',
      canUseEstimatedMmr: true,
    };
  }
  return {
    estimatedMmr: null,
    estimatedMmrText: '5620+',
    estimateLabel: '冠绝起步分',
    canUseEstimatedMmr: false,
  };
}

function buildDotaLookupView(result) {
  const source = result || {};
  const verifiedAt = Number(source.verifiedAt) || Date.now();
  const validUntil = verifiedAt + RANK_VERIFICATION_TTL;
  const rankTier = normalizeRankTier(source.rankTier);
  const rankPosition = leaderboardRank(source, true);
  const estimate = buildMmrEstimate(source, rankTier, rankPosition);
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
    rankDisplayText: dotaRankDisplayLabel(source, true),
    leaderboardRank: rankPosition,
    estimatedMmr: estimate.estimatedMmr,
    estimatedMmrText: estimate.estimatedMmrText,
    estimateLabel: estimate.estimateLabel,
    canUseEstimatedMmr: estimate.canUseEstimatedMmr,
    recentRecordText: total > 0
      ? '近 ' + total + ' 场 · ' + (Number(recent.wins) || 0) + ' 胜 ' + (Number(recent.losses) || 0) + ' 负'
      : '暂无近期公开比赛',
    recentKdaText: total > 0 && Number.isFinite(kda) ? kda.toFixed(2) : '—',
    commonHeroesText: commonHeroes.length
      ? commonHeroes.map((hero) => dotaHeroName(hero.heroId, hero.name) + '（' + (Number(hero.games) || 0) + ' 场）').join(' · ')
      : '暂无公开数据',
    showPublicDataTip: hasMissingPublicData(source),
    verifiedAt,
    verifiedAtText: formatDateTime(verifiedAt),
    validUntil,
    validUntilText: formatDateTime(validUntil),
    isExpired: Date.now() >= validUntil,
  });
}

module.exports = { buildDotaLookupView };
