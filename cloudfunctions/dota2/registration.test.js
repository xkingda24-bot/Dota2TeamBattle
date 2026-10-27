const assert = require('assert');
const { buildRegistration } = require('./registration');

const member = { nickname: '队员甲', mmr: 4200, roles: [1, 3], signature: '冲分' };
const base = {
  status: 'registration',
  mode: 'captain',
  secret: 'letmein',
  N: 2,
  K: 2,
  waitLimit: 1,
  registrations: [],
};
const noDotaFields = { dota2Id: '', dota2RankVerified: false };

let created = buildRegistration(base, 'u1', member, 'captain', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'captain');
assert.strictEqual(created.registration.teamName, '');
assert.strictEqual(created.result.auto, false);
assert.strictEqual(created.result.captainFilled, 1);
assert.strictEqual(created.result.registration, created.registration);

created = buildRegistration(base, 'u1', member, 'player', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'player');

const fullPlayers = Object.assign({}, base, {
  registrations: [
    { openid: 'p1', role: 'player' },
    { openid: 'p2', role: 'player' },
    { openid: 'p3', role: 'player' },
    { openid: 'p4', role: 'player' },
  ],
});
created = buildRegistration(fullPlayers, 'u3', member, 'player', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'waitlist');
assert.strictEqual(created.result.auto, true);
assert.strictEqual(created.result.waitlistFilled, 1);

assert.strictEqual(
  buildRegistration(Object.assign({}, fullPlayers, { waitLimit: 0 }), 'u3', member, 'player', 'letmein', noDotaFields, 123).error,
  '队员名额已满'
);
assert.strictEqual(
  buildRegistration(Object.assign({}, base, { registrations: [{ openid: 'u1', role: 'player' }] }), 'u1', member, 'player', 'letmein', noDotaFields, 123).error,
  '你已经报名过了'
);
assert.strictEqual(buildRegistration(Object.assign({}, base, { status: 'draft' }), 'u1', member, 'player', 'letmein', noDotaFields, 123).error, '当前不在报名阶段');
assert.strictEqual(buildRegistration(base, 'u1', member, 'player', 'wrong', noDotaFields, 123).error, '报名暗号错误');

console.log('Registration validation tests passed.');
