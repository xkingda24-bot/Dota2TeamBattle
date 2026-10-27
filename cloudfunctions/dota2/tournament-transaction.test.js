const assert = require('assert');
const { mutateTournament, isTransactionConflict } = require('./tournament-transaction');

function conflictError() {
  const error = new Error('transaction conflict');
  error.errCode = 'DATABASE_TRANSACTION_CONFLICT';
  return error;
}

async function testRetriesConflictAndUsesFreshDocument() {
  let attempts = 0;
  let state = { _id: 't1', registrations: [], updatedAt: 100 };
  const db = {
    async runTransaction(callback) {
      attempts += 1;
      const working = JSON.parse(JSON.stringify(state));
      const transaction = {
        collection() {
          return {
            doc() {
              return {
                async get() { return { data: working }; },
                async update({ data }) { Object.assign(working, data); },
              };
            },
          };
        },
      };
      const result = await callback(transaction);
      if (attempts < 3) {
        state = Object.assign({}, state, {
          registrations: state.registrations.concat([{ openid: 'rival-' + attempts, role: 'player' }]),
          updatedAt: state.updatedAt + 1,
        });
        throw conflictError();
      }
      state = working;
      return result;
    },
  };

  const result = await mutateTournament(db, 't1', (tournament) => ({
    data: { registrations: tournament.registrations.concat([{ openid: 'u1', role: 'player' }]) },
    result: { added: 1 },
  }), { maxAttempts: 3 });

  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(result, { result: { added: 1 }, updatedAt: state.updatedAt });
  assert.deepStrictEqual(state.registrations, [
    { openid: 'rival-1', role: 'player' },
    { openid: 'rival-2', role: 'player' },
    { openid: 'u1', role: 'player' },
  ]);
  assert.deepStrictEqual(state.registrationCounts, { captain: 0, player: 3, waitlist: 0 });
  assert.deepStrictEqual(state.registeredOpenids, ['rival-1', 'rival-2', 'u1']);
  assert(Number.isFinite(state.updatedAt));
}

async function testDoesNotRetryNonConflictErrors() {
  let attempts = 0;
  const db = {
    async runTransaction() {
      attempts += 1;
      throw new Error('permission denied');
    },
  };
  await assert.rejects(() => mutateTournament(db, 't1', () => ({ data: {} })), /permission denied/);
  assert.strictEqual(attempts, 1);
}

async function testNotFoundAndBusinessErrorsDoNotWrite() {
  let writes = 0;
  let state = null;
  const db = {
    async runTransaction(callback) {
      return callback({
        collection() {
          return { doc() { return {
            async get() { return { data: state }; },
            async update() { writes += 1; },
          }; } };
        },
      });
    },
  };
  assert.deepStrictEqual(await mutateTournament(db, 'missing', () => ({ data: {} })), { error: '比赛不存在' });
  state = { _id: 't1', status: 'draft' };
  assert.deepStrictEqual(await mutateTournament(db, 't1', () => ({ error: '当前不在报名阶段' })), { error: '当前不在报名阶段' });
  assert.strictEqual(writes, 0);
}

(async () => {
  assert(isTransactionConflict(conflictError()));
  assert(!isTransactionConflict(new Error('permission denied')));
  await testRetriesConflictAndUsesFreshDocument();
  await testDoesNotRetryNonConflictErrors();
  await testNotFoundAndBusinessErrorsDoNotWrite();
  console.log('Tournament transaction tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
