const assert = require('assert');
const {
  RANK_VERIFICATION_TTL,
  dotaRankLabel,
  isRankVerified,
  publicDotaCardFields,
} = require('./card-profile');

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
const verifiedPlayer = {
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - 1000,
  dota2LeaderboardRank: 1234,
};

assert.deepStrictEqual(
  [11, 12, 13, 14, 15, 21, 22, 23, 24, 25, 31, 32, 33, 34, 35,
    41, 42, 43, 44, 45, 51, 52, 53, 54, 55, 61, 62, 63, 64, 65,
    71, 72, 73, 74, 75, 80].map(dotaRankLabel),
  [
    '先锋1', '先锋2', '先锋3', '先锋4', '先锋5',
    '卫士1', '卫士2', '卫士3', '卫士4', '卫士5',
    '中军1', '中军2', '中军3', '中军4', '中军5',
    '统帅1', '统帅2', '统帅3', '统帅4', '统帅5',
    '传奇1', '传奇2', '传奇3', '传奇4', '传奇5',
    '万古1', '万古2', '万古3', '万古4', '万古5',
    '超凡1', '超凡2', '超凡3', '超凡4', '超凡5',
    '冠绝',
  ]
);
assert.strictEqual(dotaRankLabel(0), '未定级');
assert.strictEqual(dotaRankLabel(16), '未知段位');

assert.strictEqual(RANK_VERIFICATION_TTL, 14 * 24 * 60 * 60 * 1000);
assert.strictEqual(isRankVerified(verifiedPlayer, now), true);
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL,
}, now), false);
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL + 1,
}, now), true);
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now + 1,
}, now), false);
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2VerifiedAt: now - 1000,
}, now), true, 'legacy verification timestamp remains supported');
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - 1000,
  dota2MmrVerified: null,
}, now), true, 'rank verification does not depend on MMR verification');
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - 1000,
  dota2RankVerified: false,
}, now), false, 'an explicitly invalidated rank is not exposed');
assert.strictEqual(isRankVerified({
  dota2Id: '123456789',
  dota2RankTier: 0,
  dota2RankVerifiedAt: now - 1000,
}, now), false);
assert.strictEqual(isRankVerified({
  dota2Id: 'invalid',
  dota2RankTier: 62,
  dota2RankVerifiedAt: now - 1000,
}, now), false);

assert.deepStrictEqual(
  publicDotaCardFields(1, verifiedPlayer, null, now),
  {
    dota2RankVerified: true,
    dota2Id: '123456789',
    dota2RankTier: 62,
    dota2RankLabel: '万古2',
    dota2LeaderboardRank: 1234,
    dota2RankVerifiedAt: now - 1000,
  },
  'rank card fields are independent of the supplied self-reported MMR'
);

assert.deepStrictEqual(
  publicDotaCardFields(5600, {
    dota2Id: '123456789',
    dota2RankTier: 80,
    dota2RankLabel: 'stale custom value',
    dota2VerifiedAt: new Date(now - 1000).toISOString(),
    leaderboard_rank: null,
  }, null, now),
  {
    dota2RankVerified: true,
    dota2Id: '123456789',
    dota2RankTier: 80,
    dota2RankLabel: '冠绝',
    dota2LeaderboardRank: null,
    dota2RankVerifiedAt: now - 1000,
  },
  'legacy timestamp works and null leaderboard rank is retained as null'
);

assert.deepStrictEqual(
  publicDotaCardFields(5600, {
    dota2Id: '123456789',
    dota2RankTier: 62,
    dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL,
    dota2LeaderboardRank: 5,
  }, null, now),
  {
    dota2RankVerified: false,
    dota2Id: '',
    dota2RankTier: null,
    dota2RankLabel: '',
    dota2LeaderboardRank: null,
    dota2RankVerifiedAt: null,
  }
);

assert.deepStrictEqual(
  publicDotaCardFields(5600, {
    dota2Id: '123456789',
    dota2RankTier: 62,
    dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL,
  }, Object.assign({}, verifiedPlayer, { dota2LeaderboardRank: 10001 }), now),
  {
    dota2RankVerified: true,
    dota2Id: '123456789',
    dota2RankTier: 62,
    dota2RankLabel: '万古2',
    dota2LeaderboardRank: null,
    dota2RankVerifiedAt: now - 1000,
  },
  'falls back to a current profile when the snapshot verification has expired'
);

console.log('Verified Dota card profile tests passed.');
