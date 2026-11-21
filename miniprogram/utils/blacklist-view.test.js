const assert = require('assert');
const { remainingText, decorateBan } = require('./blacklist-view');

const now = Date.UTC(2026, 10, 21, 4, 0, 0);
const hour = 60 * 60 * 1000;
const day = 24 * hour;
assert.strictEqual(remainingText(now + 3 * day, false, now), '剩余 3 天');
assert.strictEqual(remainingText(now + 3 * hour, false, now), '剩余 3 小时');
assert.strictEqual(remainingText(now + 20 * 60 * 1000, false, now), '剩余 1 小时');
assert.strictEqual(remainingText(now - 1, false, now), '已到期');
assert.strictEqual(remainingText(null, true, now), '不会自动解除');

const decorated = decorateBan({
  openid: 'user-a',
  nickname: '队员A',
  dota2Id: '',
  duration: '1w',
  durationText: '一周',
  permanent: false,
  reason: '迟到',
  endAt: now + 7 * day,
}, now);
assert.strictEqual(decorated.dotaIdText, '未填写 ID');
assert.strictEqual(decorated.statusText, '禁赛中');
assert(decorated.endText.startsWith('禁赛至 '));
assert.strictEqual(decorated.remainingText, '剩余 7 天');
assert.strictEqual(decorateBan({ permanent: true, endAt: null }, now).statusText, '永久禁赛');

console.log('Blacklist view formatting tests passed.');
