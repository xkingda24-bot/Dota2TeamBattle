const assert = require('assert');
const { ADMIN_USER_LIST_FIELDS } = require('./query-projections');
const { TOURNAMENT_SUMMARY_FIELDS, summarize } = require('./tournament-summary');

const summary = summarize({
  _id: 't-1',
  name: 'Saturday Dota',
  time: '20:00',
  mode: 'captain',
  N: 2,
  K: 3,
  status: 'registration',
  waitLimit: 4,
  registrationCounts: { captain: 1, player: 1, waitlist: 1 },
  registeredOpenids: ['captain', 'member', 'reserve'],
  champion: null,
  creatorName: 'Ada',
  createdAt: 123,
  matches: [{ id: 'large-detail-not-needed-for-list' }],
  teams: [{ players: ['large-detail-not-needed-for-list'] }],
}, 'member');

assert.strictEqual(summary.id, 't-1');
assert.strictEqual(summary.captainFilled, 1);
assert.strictEqual(summary.playerFilled, 1);
assert.strictEqual(summary.waitlistFilled, 1);
assert.strictEqual(summary.meRegistered, true);
assert.strictEqual(summary.champion, null);
assert.ok(Object.prototype.hasOwnProperty.call(TOURNAMENT_SUMMARY_FIELDS, 'registrationCounts'));
assert.ok(Object.prototype.hasOwnProperty.call(TOURNAMENT_SUMMARY_FIELDS, 'registeredOpenids'));
assert.ok(!Object.prototype.hasOwnProperty.call(TOURNAMENT_SUMMARY_FIELDS, 'registrations'));
assert.ok(!Object.prototype.hasOwnProperty.call(TOURNAMENT_SUMMARY_FIELDS, 'matches'));
assert.ok(!Object.prototype.hasOwnProperty.call(TOURNAMENT_SUMMARY_FIELDS, 'teams'));
assert.ok(Object.prototype.hasOwnProperty.call(ADMIN_USER_LIST_FIELDS, '_openid'));
assert.ok(Object.prototype.hasOwnProperty.call(ADMIN_USER_LIST_FIELDS, 'updatedAt'));
assert.ok(!Object.prototype.hasOwnProperty.call(ADMIN_USER_LIST_FIELDS, 'cardStyle'));
assert.ok(!Object.prototype.hasOwnProperty.call(ADMIN_USER_LIST_FIELDS, 'signature'));

const legacySummary = summarize({
  mode: 'auto',
  N: 2,
  K: 2,
  registrations: [
    { openid: 'legacy-captain', role: 'captain' },
    { openid: 'legacy-player', role: 'player' },
  ],
}, 'legacy-player');
assert.strictEqual(legacySummary.captainFilled, 1);
assert.strictEqual(legacySummary.playerFilled, 1);
assert.strictEqual(legacySummary.meRegistered, true);

console.log('CloudBase list projection tests passed.');
