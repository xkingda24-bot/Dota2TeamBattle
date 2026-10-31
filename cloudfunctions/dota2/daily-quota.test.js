const assert = require('assert');
const { chinaDayRange, createQuotaId, effectiveDailyCount } = require('./daily-quota');

const beforeChinaMidnight = Date.UTC(2026, 9, 31, 15, 59, 59);
const afterChinaMidnight = Date.UTC(2026, 9, 31, 16, 0, 0);
const before = chinaDayRange(beforeChinaMidnight);
const after = chinaDayRange(afterChinaMidnight);

assert.strictEqual(before.dayKey, '2026-10-31');
assert.strictEqual(after.dayKey, '2026-11-01');
assert.strictEqual(before.end, after.start);
assert.strictEqual(before.end - before.start, 24 * 60 * 60 * 1000);
assert.notStrictEqual(createQuotaId('openid-a', before.dayKey), createQuotaId('openid-b', before.dayKey));
assert.notStrictEqual(createQuotaId('openid-a', before.dayKey), createQuotaId('openid-a', after.dayKey));
assert.strictEqual(effectiveDailyCount(2, 0), 2, 'permanent deletions do not return already consumed quota');
assert.strictEqual(effectiveDailyCount(1, 2), 2, 'existing same-day matches are counted during migration');

console.log('Daily tournament quota tests passed.');
