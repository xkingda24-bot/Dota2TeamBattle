const assert = require('assert');
const { EventEmitter } = require('events');
const https = require('https');
const { getDotaProfile } = require('./dota-profile');

const originalGet = https.get;
const payloads = {
  '/api/players/12345': {
    rank_tier: 43,
    leaderboard_rank: null,
    mmr_estimate: { estimate: 2618.4 },
    profile: {
      personaname: '测试玩家',
      avatarfull: 'https://cdn.example/avatar-full.jpg',
    },
  },
  '/api/players/67890': {
    rank_tier: 75,
    profile: { personaname: '补充数据缺失玩家' },
  },
  '/api/players/12345/recentMatches': [
    { player_slot: 0, radiant_win: true, kills: 10, deaths: 2, assists: 6 },
    { player_slot: 132, radiant_win: true, kills: 4, deaths: 4, assists: 8 },
  ],
  '/api/players/12345/heroes': [
    { hero_id: '11', games: 8, win: 7 },
    { hero_id: '2', games: 10, win: 6 },
    { hero_id: '5', games: 5, win: 2 },
    { hero_id: '14', games: 1, win: 1 },
    { hero_id: '7', games: 4, win: 3 },
    { hero_id: '6', games: 3, win: 1 },
  ],
  '/api/heroes': [
    { id: 2, localized_name: 'Axe' },
    { id: 11, localized_name: 'Shadow Fiend' },
    { id: 5, localized_name: 'Crystal Maiden' },
    { id: 14, localized_name: 'Pudge' },
    { id: 7, localized_name: 'Earthshaker' },
    { id: 6, localized_name: 'Drow Ranger' },
  ],
};

let requestCount = 0;
https.get = (options, onResponse) => {
  requestCount += 1;
  const request = new EventEmitter();
  request.destroy = (error) => {
    if (error) request.emit('error', error);
  };
  setImmediate(() => {
    const response = new EventEmitter();
    response.statusCode = payloads[options.path] ? 200 : 500;
    response.setEncoding = () => {};
    onResponse(response);
    response.emit('data', JSON.stringify(payloads[options.path] || {}));
    response.emit('end');
  });
  return request;
};

(async () => {
  const profile = await getDotaProfile('12345', 'test-openid');
  assert.strictEqual(profile.nickname, '测试玩家');
  assert.strictEqual(profile.avatarUrl, 'https://cdn.example/avatar-full.jpg');
  assert.strictEqual(profile.rankTier, 43);
  assert.strictEqual(profile.mmrEstimate, 2618);
  assert.deepStrictEqual(profile.recentStats, {
    total: 2,
    wins: 1,
    losses: 1,
    kills: 14,
    deaths: 6,
    assists: 14,
    kda: 4.67,
  });
  assert.deepStrictEqual(profile.commonHeroes, [
    { heroId: 2, name: 'Axe', games: 10, wins: 6, winRate: 60 },
    { heroId: 11, name: 'Shadow Fiend', games: 8, wins: 7, winRate: 87.5 },
    { heroId: 5, name: 'Crystal Maiden', games: 5, wins: 2, winRate: 40 },
    { heroId: 7, name: 'Earthshaker', games: 4, wins: 3, winRate: 75 },
    { heroId: 6, name: 'Drow Ranger', games: 3, wins: 1, winRate: 33.33 },
  ]);
  const callsBeforeCache = requestCount;
  const cached = await getDotaProfile('12345', 'test-openid');
  assert.strictEqual(cached.nickname, '测试玩家');
  assert.strictEqual(requestCount, callsBeforeCache, '缓存命中时不应重复请求 OpenDota');

  const partial = await getDotaProfile('67890', 'test-openid-partial');
  assert.strictEqual(partial.rankTier, 75);
  assert.strictEqual(partial.recentStats.total, 0);
  assert.strictEqual(partial.recentStats.kda, null);
  assert.deepStrictEqual(partial.commonHeroes, [], '补充接口失败时仍应返回基础段位资料');

  const { cloud } = require('./db');
  cloud.getWXContext = () => ({ OPENID: 'test-openid-action' });
  const profileActions = require('./actions/profile');
  const response = await profileActions.lookupDota({ accountId: '12345' });
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.data.nickname, '测试玩家');
  assert.strictEqual(response.data.recentStats.kda, 4.67);
  assert.strictEqual(response.data.commonHeroes.length, 5);
  assert(response.data.verifiedAt > 0, '公开 lookupDota 动作应返回本次校验时间');

  const { db } = require('./db');
  const originalCollection = db.collection;
  const originalMsgSecCheck = cloud.openapi.security.msgSecCheck;
  const records = [{
    _id: 'user-1',
    _openid: 'test-openid-action',
    openid: 'test-openid-action',
    nickname: '旧昵称',
    mmr: 4000,
    roles: [1],
    dota2Id: '',
  }];
  const updates = [];
  cloud.openapi.security.msgSecCheck = async () => ({ errCode: 0 });
  db.collection = (name) => {
    assert.strictEqual(name, 'users');
    return {
      where(filter) {
        const query = {
          limit() { return query; },
          async get() {
            return { data: records.filter((record) => Object.keys(filter).every((key) => record[key] === filter[key])) };
          },
        };
        return query;
      },
      doc(id) {
        return {
          async update({ data }) { updates.push({ id, data }); },
          async remove() {},
        };
      },
    };
  };

  const saved = await profileActions.saveProfile({
    nickname: '资料昵称',
    mmr: 4500,
    roles: [1, 2],
    signature: '',
    dota2Id: '12345',
    dotaRankConfirmed: true,
    dota2RankTier: 43,
    dota2LeaderboardRank: null,
  });
  assert.strictEqual(saved.success, true);
  const savedSnapshot = updates[0].data.dota2LookupSnapshot;
  assert.strictEqual(savedSnapshot.accountId, '12345');
  assert.strictEqual(savedSnapshot.nickname, '测试玩家');
  assert.strictEqual(savedSnapshot.recentStats.kda, 4.67);
  assert.strictEqual(savedSnapshot.commonHeroes.length, 5);
  assert.strictEqual(savedSnapshot.verifiedAt, updates[0].data.dota2RankVerifiedAt);

  records[0] = Object.assign({}, records[0], updates[0].data);
  const expiredSnapshot = Object.assign({}, savedSnapshot, {
    verifiedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
  });
  records[0].dota2RankVerifiedAt = expiredSnapshot.verifiedAt;
  records[0].dota2VerifiedAt = expiredSnapshot.verifiedAt;
  records[0].dota2LookupSnapshot = expiredSnapshot;
  const savedWithExpiredSnapshot = await profileActions.saveProfile({
    nickname: '资料昵称',
    mmr: 4600,
    roles: [1, 2],
    signature: '',
    dota2Id: '12345',
  });
  assert.strictEqual(savedWithExpiredSnapshot.success, true);
  assert.deepStrictEqual(
    updates[1].data.dota2LookupSnapshot,
    expiredSnapshot,
    '修改其他资料时，过期快照仍应保留供下次打开查看'
  );

  const autoSaved = await profileActions.lookupDota({ accountId: '12345', autoSave: true });
  assert.strictEqual(autoSaved.success, true);
  assert.strictEqual(autoSaved.data.autoSaved, true);
  const autoSavedData = updates[2].data;
  assert.strictEqual(autoSavedData.dota2Id, '12345');
  assert.strictEqual(autoSavedData.dota2RankVerified, true);
  assert.strictEqual(autoSavedData.dota2LookupSnapshot.nickname, '测试玩家');
  assert.strictEqual(autoSavedData.dota2LookupSnapshot.verifiedAt, autoSavedData.dota2RankVerifiedAt);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(autoSavedData, 'nickname'), false, '自动保存不得修改昵称');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(autoSavedData, 'mmr'), false, '自动保存不得修改天梯分');

  db.collection = originalCollection;
  cloud.openapi.security.msgSecCheck = originalMsgSecCheck;
  console.log('OpenDota enriched profile, recent stats, heroes and cache tests passed.');
})().finally(() => {
  https.get = originalGet;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
