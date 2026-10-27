const assert = require('assert');
const api = require('./api');
const { refreshIfChanged, versionToken, hasVersionChanged } = require('./tournament-polling');

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

async function testRefreshIfChanged() {
  const originalCall = api.call;
  let calls = 0;
  let loads = 0;
  api.call = async () => {
    calls += 1;
    return { updatedAt: 123, status: 'battle' };
  };
  try {
    const page = {
      id: 't1',
      data: { t: { id: 't1' } },
      _lastTournamentVersion: versionToken({ updatedAt: 123, status: 'battle' }),
      load() { loads += 1; return Promise.resolve(); },
    };
    await refreshIfChanged(page);
    assert.strictEqual(calls, 1);
    assert.strictEqual(loads, 0);

    page._lastTournamentVersion = versionToken({ updatedAt: 122, status: 'battle' });
    await refreshIfChanged(page);
    assert.strictEqual(loads, 1);

    let snapshots = 0;
    page.refreshTournamentSnapshot = () => { snapshots += 1; return Promise.resolve(); };
    page._lastTournamentVersion = versionToken({ updatedAt: 122, status: 'battle' });
    await refreshIfChanged(page);
    assert.strictEqual(snapshots, 1);
    assert.strictEqual(loads, 1);

    api.call = async () => { throw new Error('temporary network error'); };
    await refreshIfChanged(page);
    assert.strictEqual(loads, 2);
  } finally {
    api.call = originalCall;
  }
}

testRefreshIfChanged().then(() => {
  console.log('Tournament polling version token tests passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
