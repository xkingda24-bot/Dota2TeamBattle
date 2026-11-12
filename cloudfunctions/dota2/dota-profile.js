/**
 * OpenDota 公开资料查询：进程内缓存 + 每用户限频。
 * 从原 index.js 拆出（纯搬移）。
 */
const https = require('https');
const { dotaRankLabel } = require('./card-profile');
const {
  DOTA_ID_RE,
  DOTA_CACHE_TTL,
  DOTA_CACHE_MAX,
  DOTA_LOOKUP_LIMIT,
  DOTA_LOOKUP_WINDOW,
} = require('./constants');

const dotaProfileCache = new Map();
const dotaLookupHits = new Map();

function cleanDotaCache(now) {
  for (const [accountId, entry] of dotaProfileCache) {
    if (now - entry.cachedAt >= DOTA_CACHE_TTL) dotaProfileCache.delete(accountId);
  }
  while (dotaProfileCache.size >= DOTA_CACHE_MAX) {
    dotaProfileCache.delete(dotaProfileCache.keys().next().value);
  }
}

function fetchDotaProfile(accountId) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: 'api.opendota.com',
        path: '/api/players/' + accountId,
        headers: { Accept: 'application/json' },
        timeout: 5000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024) request.destroy(new Error('response_too_large'));
        });
        response.on('end', () => {
          if (response.statusCode === 404) {
            reject(new Error('该 ID 无公开记录（可能是私有 Profile 或 ID 错误）'));
            return;
          }
          if (response.statusCode !== 200) {
            reject(new Error('OpenDota 查询失败，请稍后重试'));
            return;
          }
          let payload;
          try {
            payload = JSON.parse(body);
          } catch (e) {
            reject(new Error('OpenDota 返回数据异常'));
            return;
          }
          const profile = payload && payload.profile;
          const rankTier = Number(payload.rank_tier) || 0;
          const rankLabel = dotaRankLabel(rankTier);
          const leaderboardValue = payload.leaderboard_rank;
          const leaderboardRank = Number.isInteger(Number(leaderboardValue)) &&
            Number(leaderboardValue) >= 1 && Number(leaderboardValue) <= 10000
            ? Number(leaderboardValue)
            : null;
          resolve({
            accountId,
            nickname: String(profile && profile.personaname || '').trim() || '未知玩家',
            rankTier,
            rankLabel,
            leaderboardRank,
          });
        });
        response.on('error', () => reject(new Error('OpenDota 查询失败，请稍后重试')));
      }
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      reject(error && error.message === 'timeout'
        ? new Error('OpenDota 查询超时，请稍后重试')
        : error && error.message === 'response_too_large'
          ? new Error('OpenDota 返回数据异常')
          : new Error('OpenDota 查询失败，请稍后重试'));
    });
  });
}

async function getDotaProfile(rawAccountId, openid) {
  const accountId = String(rawAccountId == null ? '' : rawAccountId).trim();
  if (!DOTA_ID_RE.test(accountId)) throw new Error('请输入正确的 Dota2 数字 ID（5-12 位）');
  const now = Date.now();
  const cached = dotaProfileCache.get(accountId);
  if (cached && now - cached.cachedAt < DOTA_CACHE_TTL) return Object.assign({}, cached.profile);
  if (!openid || !allowDotaLookup(openid)) throw new Error('查询太频繁，请稍后再试');
  const profile = await fetchDotaProfile(accountId);
  cleanDotaCache(Date.now());
  dotaProfileCache.set(accountId, { cachedAt: Date.now(), profile });
  return Object.assign({}, profile);
}

function allowDotaLookup(openid) {
  const now = Date.now();
  if (dotaLookupHits.size > 1000) {
    for (const [id, entry] of dotaLookupHits) {
      if (now - entry.startedAt >= DOTA_LOOKUP_WINDOW * 10) dotaLookupHits.delete(id);
    }
  }
  const previous = dotaLookupHits.get(openid);
  if (!previous || now - previous.startedAt >= DOTA_LOOKUP_WINDOW) {
    dotaLookupHits.set(openid, { startedAt: now, count: 1 });
    return true;
  }
  if (previous.count >= DOTA_LOOKUP_LIMIT) return false;
  previous.count += 1;
  return true;
}

module.exports = { getDotaProfile };
