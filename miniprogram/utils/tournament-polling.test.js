const assert = require('assert');
const { versionToken, hasVersionChanged } = require('./tournament-polling');

assert.strictEqual(
  versionToken({ updatedAt: 123, status: 'battle', deletedAt: null }),
  '123:battle:'
);
assert.strictEqual(
  versionToken({ createdAt: 123, status: 'battle' }),
  '123:battle:'
);
assert.notStrictEqual(
  versionToken({ updatedAt: 123, status: 'registration' }),
  versionToken({ updatedAt: 123, status: 'draft' })
);
assert.notStrictEqual(
  versionToken({ updatedAt: 123, status: 'battle' }),
  versionToken({ updatedAt: 123, status: 'battle', deletedAt: 456 })
);
assert.strictEqual(versionToken(null), '');

const deletedPage = {
  _lastTournamentVersion: versionToken({ updatedAt: 123, status: 'battle' }),
};
const deletedVersion = { updatedAt: 124, status: 'battle', deletedAt: 456 };
assert.strictEqual(hasVersionChanged(deletedPage, deletedVersion), true);
assert.strictEqual(deletedPage._lastTournamentVersion, versionToken(deletedVersion));
assert.strictEqual(hasVersionChanged(deletedPage, deletedVersion), false);

console.log('Tournament polling version token tests passed.');
