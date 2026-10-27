const api = require('./api');

const POLL_INTERVAL_MS = 25000;
const POLL_JITTER_MS = 5000;
const RETRY_DELAY_MS = 1500;
const FULL_REFRESH_MS = 120000;

function versionToken(value) {
  if (!value) return '';
  return [
    Number(value.updatedAt || value.createdAt || 0),
    value.status || '',
    value.deletedAt || '',
  ].join(':');
}

function hasVersionChanged(page, value) {
  const token = versionToken(value);
  const changed = token !== page._lastTournamentVersion;
  if (changed) page._lastTournamentVersion = token;
  return changed;
}

function schedule(page, generation, delay) {
  if (!page._pollActive || page._pollGeneration !== generation) return;
  page._timer = setTimeout(() => poll(page, generation), delay);
}

function start(page) {
  stop(page);
  page._pollActive = true;
  schedule(page, page._pollGeneration, POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS);
}

function stop(page) {
  page._pollActive = false;
  page._pollGeneration = (page._pollGeneration || 0) + 1;
  if (page._timer) clearTimeout(page._timer);
  page._timer = null;
}

function poll(page, generation) {
  page._timer = null;
  if (!page._pollActive || page._pollGeneration !== generation) return;
  if (page._pollInFlight) {
    schedule(page, generation, RETRY_DELAY_MS);
    return;
  }

  page._pollInFlight = true;
  const request = page.id
    ? api.call('tournamentVersion', { id: page.id }).then((version) => {
        if (!page._pollActive || page._pollGeneration !== generation) return;
        // Cache the observed version before loading details. A tournament in
        // the recycle bin has a valid version but its normal detail endpoint
        // intentionally returns "not found"; without this, every poll retries
        // the same failed detail request.
        const changed = hasVersionChanged(page, version);
        if (changed || Date.now() - (page._lastFullSyncAt || 0) >= FULL_REFRESH_MS) {
          return page.load(true);
        }
      })
    : page.load(true);

  Promise.resolve(request)
    .then(() => { page._pollFailures = 0; })
    .catch(() => {
      page._pollFailures = (page._pollFailures || 0) + 1;
      if (page._pollFailures >= 3 && page._pollActive && page._pollGeneration === generation) {
        return page.load(true).then(() => { page._pollFailures = 0; });
      }
      return undefined;
    })
    .finally(() => {
      page._pollInFlight = false;
      if (page._pollActive && page._pollGeneration === generation) {
        schedule(page, generation, POLL_INTERVAL_MS + Math.random() * POLL_JITTER_MS);
      }
    });
}

module.exports = { start, stop, versionToken, hasVersionChanged };
