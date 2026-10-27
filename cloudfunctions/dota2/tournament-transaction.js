const DEFAULT_MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 500;

function isTransactionConflict(error) {
  const code = String(error && (error.errCode || error.code) || '');
  const message = String(error && error.message || '');
  return /TRANSACTION.*(CONFLICT|ABORT|LOCK)|WRITE_CONFLICT|ABORTED/i.test(code) ||
    /transaction.{0,50}(conflict|abort|lock|retry)|write conflict/i.test(message);
}

function retryDelay(attempt) {
  const ceiling = Math.min(MAX_BACKOFF_MS, 20 * (2 ** Math.max(0, attempt - 1)));
  return Math.floor(ceiling * (0.75 + Math.random() * 0.5));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countRegistrations(registrations) {
  const counts = { captain: 0, player: 0, waitlist: 0 };
  (Array.isArray(registrations) ? registrations : []).forEach((registration) => {
    if (registration && Object.prototype.hasOwnProperty.call(counts, registration.role)) counts[registration.role] += 1;
  });
  return counts;
}

function buildRegistrationSummary(registrations) {
  const source = Array.isArray(registrations) ? registrations : [];
  return {
    registrationCounts: countRegistrations(source),
    registeredOpenids: Array.from(new Set(
      source
        .filter((registration) => registration && typeof registration.openid === 'string' && registration.openid)
        .map((registration) => registration.openid)
    )),
  };
}

async function mutateTournament(db, tournamentId, mutate, options) {
  const opts = options || {};
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const notFoundMessage = opts.notFoundMessage || '比赛不存在';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.runTransaction(async (transaction) => {
        const ref = transaction.collection('tournaments').doc(tournamentId);
        const result = await ref.get();
        const tournament = result && result.data;
        if (!tournament || (!opts.includeDeleted && tournament.deletedAt)) {
          return { error: notFoundMessage };
        }

        const change = await mutate(tournament);
        if (!change || change.error) return change || { error: '操作失败' };
        if (change.data) {
          const previousVersion = Number(tournament.updatedAt || tournament.createdAt || 0);
          const updatedAt = Math.max(Date.now(), previousVersion + 1);
          const updateData = Object.assign({}, change.data);
          if (Object.prototype.hasOwnProperty.call(updateData, 'registrations')) {
            Object.assign(updateData, buildRegistrationSummary(updateData.registrations));
          }
          await ref.update({
            data: Object.assign(updateData, { updatedAt }),
          });
          return { result: change.result, updatedAt };
        }
        return { result: change.result };
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt >= maxAttempts) throw error;
      await wait(retryDelay(attempt));
    }
  }

  throw new Error('赛事更新失败，请重试');
}

module.exports = { mutateTournament, isTransactionConflict, countRegistrations, buildRegistrationSummary };
