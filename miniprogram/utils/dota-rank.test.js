const assert = require('assert');
const {
  RANK_VERIFICATION_TTL,
  dotaRankLabel,
  toTimestamp,
  hasCurrentRankVerification,
  leaderboardRank,
} = require('./dota-rank');

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
assert.strictEqual(RANK_VERIFICATION_TTL, 14 * 24 * 60 * 60 * 1000);
assert.deepStrictEqual(
  [11, 15, 21, 25, 31, 35, 41, 45, 51, 55, 61, 65, 71, 75, 80].map(dotaRankLabel),
  ['先锋1', '先锋5', '卫士1', '卫士5', '中军1', '中军5', '统帅1', '统帅5',
    '传奇1', '传奇5', '万古1', '万古5', '超凡1', '超凡5', '冠绝']
);
assert.strictEqual(dotaRankLabel(16), '未知段位');
assert.strictEqual(toTimestamp(String(now)), now);
assert.strictEqual(toTimestamp(new Date(now).toISOString()), now);

const verified = { dota2Id: '123456789', dota2RankTier: 62, dota2RankVerifiedAt: now - 1000 };
assert.strictEqual(hasCurrentRankVerification(verified, now), true);
assert.strictEqual(hasCurrentRankVerification(Object.assign({}, verified, { dota2RankVerifiedAt: now - RANK_VERIFICATION_TTL }), now), false);
assert.strictEqual(hasCurrentRankVerification(Object.assign({}, verified, { dota2Id: 'invalid' }), now), false);
assert.strictEqual(hasCurrentRankVerification(Object.assign({}, verified, { dota2MmrVerified: null }), now), true);
assert.strictEqual(leaderboardRank({ dota2LeaderboardRank: 10000 }, true), 10000);
assert.strictEqual(leaderboardRank({ dota2LeaderboardRank: 10001 }, true), null);
assert.strictEqual(leaderboardRank({ dota2LeaderboardRank: 1 }, false), null);

console.log('Verified mini-program Dota rank utility tests passed.');
