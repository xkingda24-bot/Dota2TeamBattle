const assert = require('assert');
const { buildTestRegistrationAdditions } = require('./test-registration');

const now = Date.UTC(2026, 9, 23, 12, 0, 0);
const captainTournament = {
  _id: 'captain-tournament',
  mode: 'captain',
  N: 2,
  K: 3,
  waitLimit: 2,
  registrations: [
    { openid: 'real-captain', role: 'captain', nickname: '真实队长' },
    { openid: 'real-player', role: 'player', nickname: '真实队员' },
    { openid: 'real-waitlist', role: 'waitlist', nickname: '真实替补' },
  ],
};
const captainResult = buildTestRegistrationAdditions(captainTournament, now);
assert.deepStrictEqual(captainResult.targets, { captain: 2, player: 6, waitlist: 2 });
assert.deepStrictEqual(captainResult.counts, { captain: 2, player: 6, waitlist: 2 });
assert.deepStrictEqual(
  captainResult.additions.reduce((counts, registration) => {
    counts[registration.role] += 1;
    return counts;
  }, { captain: 0, player: 0, waitlist: 0 }),
  { captain: 1, player: 5, waitlist: 1 }
);
assert(captainResult.additions.every((registration) => registration.dota2Id && registration.mmr && registration.roles.length));
assert(captainResult.additions.filter((registration) => registration.role === 'captain').every((registration) => registration.teamName === ''));
assert.strictEqual(new Set(captainResult.additions.map((registration) => registration.openid)).size, captainResult.additions.length);

const autoResult = buildTestRegistrationAdditions({
  _id: 'auto-tournament',
  mode: 'auto',
  N: 2,
  K: 2,
  waitLimit: 1,
  registrations: [{ openid: 'real-player', role: 'player' }],
}, now);
assert.deepStrictEqual(autoResult.counts, { captain: 0, player: 4, waitlist: 1 });
assert.strictEqual(autoResult.additions.filter((registration) => registration.role === 'captain').length, 0);
assert.strictEqual(autoResult.additions.filter((registration) => registration.role === 'player').length, 3);
assert.strictEqual(autoResult.additions.filter((registration) => registration.role === 'waitlist').length, 1);

const fullResult = buildTestRegistrationAdditions({
  _id: 'full-tournament',
  mode: 'captain',
  N: 1,
  K: 1,
  waitLimit: 1,
  registrations: [
    { openid: 'captain', role: 'captain' },
    { openid: 'player', role: 'player' },
    { openid: 'waitlist', role: 'waitlist' },
  ],
}, now);
assert.strictEqual(fullResult.additions.length, 0, 'a full list needs no additional test registrations');

console.log('Test registration fill tests passed.');
