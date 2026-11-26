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

function requestDotaJson(path) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      {
        hostname: 'api.opendota.com',
        path,
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
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('OpenDota 返回数据异常'));
          }
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

function roundStat(value) {
  return Math.round(value * 100) / 100;
}

function summarizeRecentMatches(matches) {
  const list = (Array.isArray(matches) ? matches : []).filter((match) =>
    match && typeof match.radiant_win === 'boolean' && Number.isFinite(Number(match.player_slot))
  ).slice(0, 20);
  const stats = { total: list.length, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, kda: null };
  list.forEach((match) => {
    const isRadiant = Number(match.player_slot) < 128;
    if (match.radiant_win === isRadiant) stats.wins += 1;
    else stats.losses += 1;
    stats.kills += Number(match.kills) || 0;
    stats.deaths += Number(match.deaths) || 0;
    stats.assists += Number(match.assists) || 0;
  });
  if (stats.total > 0) stats.kda = roundStat((stats.kills + stats.assists) / Math.max(1, stats.deaths));
  return stats;
}

function buildCommonHeroes(playerHeroes, heroCatalog) {
  const names = {};
  (Array.isArray(heroCatalog) ? heroCatalog : []).forEach((hero) => {
    if (hero && hero.id !== undefined) names[Number(hero.id)] = String(hero.localized_name || '').trim();
  });
  return (Array.isArray(playerHeroes) ? playerHeroes : [])
    .filter((hero) => hero && Number(hero.games) > 0)
    .sort((a, b) => Number(b.games) - Number(a.games))
    .slice(0, 5)
    .map((hero) => {
      const heroId = Number(hero.hero_id);
      const games = Number(hero.games);
      const wins = Number(hero.win) || 0;
      return {
        heroId,
        name: names[heroId] || '英雄 ' + heroId,
        games,
        wins,
        winRate: roundStat(wins / games * 100),
      };
    });
}

async function fetchDotaProfile(accountId) {
  const payload = await requestDotaJson('/api/players/' + accountId);
  const profile = payload && payload.profile;
  const rankTier = Number(payload.rank_tier) || 0;
  const rankLabel = dotaRankLabel(rankTier);
  const leaderboardValue = payload.leaderboard_rank;
  const leaderboardRank = Number.isInteger(Number(leaderboardValue)) &&
    Number(leaderboardValue) >= 1 && Number(leaderboardValue) <= 10000
    ? Number(leaderboardValue)
    : null;
  const mmrEstimateValue = Number(payload.mmr_estimate && payload.mmr_estimate.estimate);
  const mmrEstimate = Number.isFinite(mmrEstimateValue) && mmrEstimateValue >= 1 && mmrEstimateValue <= 20000
    ? Math.round(mmrEstimateValue)
    : null;

  // 补充数据失败不影响段位校验；三个接口并行，避免串行增加等待时间。
  const [recentMatches, playerHeroes, heroCatalog] = await Promise.all([
    requestDotaJson('/api/players/' + accountId + '/recentMatches').catch(() => []),
    requestDotaJson('/api/players/' + accountId + '/heroes').catch(() => []),
    requestDotaJson('/api/heroes').catch(() => []),
  ]);
  return {
    accountId,
    nickname: String(profile && profile.personaname || '').trim() || '未知玩家',
    avatarUrl: String(profile && (profile.avatarfull || profile.avatarmedium || profile.avatar) || '').trim(),
    rankTier,
    rankLabel,
    leaderboardRank,
    mmrEstimate,
    recentStats: summarizeRecentMatches(recentMatches),
    commonHeroes: buildCommonHeroes(playerHeroes, heroCatalog),
  };
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
