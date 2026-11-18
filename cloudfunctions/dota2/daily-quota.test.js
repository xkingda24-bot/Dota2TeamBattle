const assert = require('assert');
const { chinaDayRange, createQuotaId, effectiveDailyCount, createDailyLimit } = require('./daily-quota');
const { hasTournamentCreateAccess } = require('./create-permission');

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
assert.strictEqual(createDailyLimit(true), 20, 'admins and granted users share the 20 per day limit');
assert.strictEqual(createDailyLimit(false), 0, 'users without create permission have no quota');
assert.strictEqual(createDailyLimit(undefined), 0, 'missing create flag denies creation');
assert.strictEqual(hasTournamentCreateAccess(null, true), true, 'ordinary and super admins always have access');
assert.strictEqual(hasTournamentCreateAccess({ canCreateTournament: true }, false), true, 'granted ordinary users have access');
assert.strictEqual(hasTournamentCreateAccess({ canCreateTournament: false }, false), false, 'revoked ordinary users lose access');
assert.strictEqual(hasTournamentCreateAccess({}, false), false, 'legacy profiles default to no access');

console.log('Daily tournament quota tests passed.');
