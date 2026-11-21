const assert = require('assert');
const {
  isBanActive,
  buildBanRecord,
  publicBanView,
  banNotice,
  attachActiveBans,
} = require('./blacklist');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 21, 4, 0, 0);
const target = { openid: 'user-a', nickname: '队员A', dota2Id: '123456' };

const twoDays = buildBanRecord({ target, duration: '2d', reason: ' 迟到 ', operatorOpenid: 'super', now });
assert.strictEqual(twoDays.error, undefined);
assert.strictEqual(twoDays.record.reason, '迟到');
assert.strictEqual(twoDays.record.startAt, now);
assert.strictEqual(twoDays.record.endAt, now + 2 * DAY);
assert.strictEqual(twoDays.record.permanent, false);
assert.strictEqual(isBanActive(twoDays.record, now + 2 * DAY - 1), true);
assert.strictEqual(isBanActive(twoDays.record, now + 2 * DAY), false, '到期时刻立即自动解除');
assert.strictEqual(isBanActive(Object.assign({}, twoDays.record, { liftedAt: now + 1 }), now + 2), false);

['4d', '1w', '2w'].forEach((duration, index) => {
  const days = [4, 7, 14][index];
  const result = buildBanRecord({ target, duration, reason: '测试', operatorOpenid: 'super', now });
  assert.strictEqual(result.record.endAt, now + days * DAY);
});
const permanent = buildBanRecord({ target, duration: 'permanent', reason: '恶意弃权', operatorOpenid: 'super', now });
assert.strictEqual(permanent.record.endAt, null);
assert.strictEqual(isBanActive(permanent.record, now + 1000 * DAY), true);
assert.strictEqual(publicBanView(permanent.record).durationText, '永久');

assert(buildBanRecord({ target, duration: '', reason: '测试', now }).error);
assert(buildBanRecord({ target, duration: '2d', reason: ' ', now }).error);
assert(buildBanRecord({ target, duration: '2d', reason: 'x'.repeat(101), now }).error);

// 调整有效禁赛：从原开始时间重新计算；已到期或已解除后再次禁赛则重新开始。
const adjusted = buildBanRecord({ target, existing: twoDays.record, duration: '1w', reason: '调整', operatorOpenid: 'super', now: now + DAY });
assert.strictEqual(adjusted.adjusted, true);
assert.strictEqual(adjusted.record.startAt, now);
assert.strictEqual(adjusted.record.endAt, now + 7 * DAY);
assert.strictEqual(adjusted.record.createdAt, now);
const restarted = buildBanRecord({ target, existing: twoDays.record, duration: '4d', reason: '重新禁赛', operatorOpenid: 'super', now: now + 3 * DAY });
assert.strictEqual(restarted.adjusted, false);
assert.strictEqual(restarted.record.startAt, now + 3 * DAY);
assert.strictEqual(restarted.record.liftedAt, null);

const users = attachActiveBans(
  [{ openid: 'user-a', nickname: '新昵称' }, { openid: 'user-b', nickname: '队员B' }],
  [twoDays.record],
  now + DAY
);
assert.strictEqual(users[0].ban.nickname, '新昵称', '展示最新用户昵称');
assert.strictEqual(users[1].ban, null);
assert.strictEqual(attachActiveBans(users, [twoDays.record], now + 3 * DAY)[0].ban, null);
assert(banNotice(twoDays.record).includes('2026-11-23 12:00'));
assert(banNotice(twoDays.record).includes('迟到'));
assert(banNotice(permanent.record).includes('永久禁赛'));

console.log('Blacklist duration, active state, adjustment and notice tests passed.');
