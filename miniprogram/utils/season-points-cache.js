const api = require('./api');

const CACHE_TTL_MS = 60 * 1000;
const MAX_BATCH_SIZE = 100;
const cache = new Map();
const pending = new Map();
let queuedOpenids = new Set();
let flushScheduled = false;
let cacheSeasonId = '';

function currentSeasonId() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return now.getUTCFullYear() + 'Q' + quarter;
}

function cacheKey(seasonId, openid) {
  return seasonId + ':' + openid;
}

function flushQueue() {
  flushScheduled = false;
  const seasonId = currentSeasonId();
  if (cacheSeasonId !== seasonId) {
    cache.clear();
    cacheSeasonId = seasonId;
  }
  const openids = Array.from(queuedOpenids);
  queuedOpenids = new Set();
  if (!openids.length) return;

  const batches = [];
  for (let offset = 0; offset < openids.length; offset += MAX_BATCH_SIZE) {
    batches.push(openids.slice(offset, offset + MAX_BATCH_SIZE));
  }
  batches.forEach((batch) => {
    api.callFunction('seasonPoints', 'getCardPoints', { openids: batch })
      .then((result) => {
        if (!result || !result.enabled || result.seasonId !== currentSeasonId() || !Array.isArray(result.points)) {
          batch.forEach((openid) => settle(openid, null, seasonId));
          return;
        }
        batch.forEach((openid, index) => settle(openid, result.points[index], seasonId));
      })
      .catch(() => batch.forEach((openid) => settle(openid, null, seasonId)));
  });
}

function settle(openid, points, seasonId) {
  const key = cacheKey(seasonId, openid);
  pending.delete(key);
  const cachedPoints = points === null || !Number.isFinite(Number(points)) ? null : Number(points);
  cache.set(key, { points: cachedPoints, expiresAt: Date.now() + CACHE_TTL_MS });
  const resolve = pendingResolvers.get(key);
  if (resolve) {
    pendingResolvers.delete(key);
    resolve(cachedPoints);
  }
}

const pendingResolvers = new Map();

function getSeasonPoints(openidValue) {
  const openid = String(openidValue || '').trim();
  if (!openid) return Promise.resolve(null);
  const seasonId = currentSeasonId();
  if (cacheSeasonId !== seasonId) {
    cache.clear();
    cacheSeasonId = seasonId;
  }
  const key = cacheKey(seasonId, openid);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.points);
  if (cached) cache.delete(key);
  if (pending.has(key)) return pending.get(key);

  const promise = new Promise((resolve) => pendingResolvers.set(key, resolve));
  pending.set(key, promise);
  queuedOpenids.add(openid);
  if (!flushScheduled) {
    flushScheduled = true;
    setTimeout(flushQueue, 0);
  }
  return promise;
}

function clearSeasonPointsCache() {
  cache.clear();
  cacheSeasonId = currentSeasonId();
}

module.exports = { getSeasonPoints, clearSeasonPointsCache };
