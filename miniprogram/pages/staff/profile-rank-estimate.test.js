const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../../utils/api');

const indexWxml = fs.readFileSync(path.join(__dirname, '../index/index.wxml'), 'utf8');
const staffWxml = fs.readFileSync(path.join(__dirname, './staff.wxml'), 'utf8');

function assertFormLayout(wxml, idValue) {
  const idInput = wxml.indexOf('value="' + idValue + '"');
  const lookup = wxml.indexOf('bindtap="onLookupDota"', idInput);
  const resultCard = wxml.indexOf('class="dota-result-card"', lookup);
  assert(idInput >= 0 && lookup > idInput && resultCard > lookup, '校验结果卡片应位于 Dota ID 校验入口下方');
  ['<view class="field-label">段位</view>', '段位校验只读取', '已校验于', '段位校验已过期', '预估分数'].forEach((obsolete) => {
    assert(!wxml.includes(obsolete), '结果卡片外不应再显示：' + obsolete);
  });
  assert(wxml.includes('bindtap="onUseEstimatedMmr"'));
  assert(wxml.includes('使用预估分'));
  ['校验结果', 'avatarUrl', 'nickname', 'recentRecordText', 'recentKdaText', 'commonHeroesText', 'verifiedAtText', 'validUntilText'].forEach((field) => {
    assert(wxml.includes(field), '校验结果卡片缺少 ' + field);
  });
  assert(wxml.includes('（7 天）'), '校验结果卡片应标明 7 天有效期');
}
assertFormLayout(indexWxml, '{{pfDota2Id}}');
assertFormLayout(staffWxml, '{{pf.dota2Id}}');

function loadDefinition(relativePath) {
  let definition = null;
  global.Page = (value) => { definition = value; };
  require(relativePath);
  delete global.Page;
  return definition;
}

const indexDefinition = loadDefinition('../index/index.js');
const staffDefinition = loadDefinition('./staff.js');

function createPage(definition) {
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.keys(patch).forEach((key) => {
        const parts = key.split('.');
        let target = this.data;
        while (parts.length > 1) {
          const part = parts.shift();
          if (!target[part]) target[part] = {};
          target = target[part];
        }
        target[parts[0]] = patch[key];
      });
    },
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function' && !page[key]) page[key] = definition[key];
  });
  return page;
}

const originalCall = api.call;
const verifiedAt = Date.UTC(2026, 10, 24, 8, 0, 0);
global.wx = {
  showToast() {},
  showModal() { throw new Error('段位校验不应再弹出确认框'); },
};

async function verifyLookupAndFill(definition, page, idKey, estimateKey, mmrKey) {
  page.setData({ [idKey]: '12345' });
  definition.onLookupDota.call(page);
  await new Promise((resolve) => setImmediate(resolve));
  const pf = page.data.pf || page.data;
  assert.strictEqual(pf[estimateKey], 2618, '统帅3应估算为 2618 分');
  const lookup = page.data.pf ? page.data.pf.dotaLookup : page.data.pfDotaLookup;
  assert(lookup, '校验成功后应直接生成结果卡片数据');
  assert.strictEqual(lookup.avatarUrl, 'https://cdn.example/avatar.jpg');
  assert.strictEqual(lookup.nickname, '测试玩家');
  assert.strictEqual(lookup.recentRecordText, '近 2 场 · 1 胜 1 负');
  assert.strictEqual(lookup.recentKdaText, '4.67');
  assert.strictEqual(lookup.commonHeroesText, '斧王（10 场） · 影魔（8 场）');
  assert.strictEqual(lookup.verifiedAt, verifiedAt);
  assert.strictEqual(lookup.validUntil - verifiedAt, 7 * 24 * 60 * 60 * 1000);
  definition.onUseEstimatedMmr.call(page);
  assert.strictEqual(pf[mmrKey], '2618', '点击后应把预估分填入天梯分');

  if (page.data.pf) {
    definition.onPfDotaId.call(page, { detail: { value: '67890' } });
    assert.strictEqual(page.data.pf[estimateKey], null, '更换 ID 后应清空旧预估分');
  } else {
    definition.onPfDotaId.call(page, { detail: { value: '67890' } });
    assert.strictEqual(page.data[estimateKey], null, '更换 ID 后应清空旧预估分');
  }
  pf[mmrKey] = '1000';
  definition.onUseEstimatedMmr.call(page);
  assert.strictEqual(pf[mmrKey], '1000', '没有有效预估分时不能覆盖天梯分');
}

(async () => {
  api.call = (action, payload) => {
    assert.strictEqual(action, 'lookupDota');
    assert.strictEqual(payload.accountId, '12345');
    const result = {
      accountId: '12345',
      rankTier: 43,
      verifiedAt,
      nickname: '测试玩家',
      avatarUrl: 'https://cdn.example/avatar.jpg',
      recentStats: { total: 2, wins: 1, losses: 1, kda: 4.67 },
      commonHeroes: [
        { heroId: 2, name: 'Axe', games: 10 },
        { heroId: 11, name: 'Shadow Fiend', games: 8 },
      ],
    };
    if (payload.autoSave === true) {
      result.autoSaved = true;
      result.savedProfile = {
        dota2Id: '12345',
        dota2RankVerified: true,
        dota2RankTier: 43,
        dota2RankLabel: '统帅3',
        dota2LeaderboardRank: null,
        dota2RankVerifiedAt: verifiedAt,
        dota2VerifiedAt: verifiedAt,
        dota2Nickname: '测试玩家',
        dota2LookupSnapshot: {
          accountId: '12345',
          rankTier: 43,
          verifiedAt,
          nickname: '测试玩家',
          avatarUrl: 'https://cdn.example/avatar.jpg',
          recentStats: result.recentStats,
          commonHeroes: result.commonHeroes,
        },
      };
    }
    return Promise.resolve(result);
  };
  await verifyLookupAndFill(indexDefinition, createPage(indexDefinition), 'pfDota2Id', 'pfDotaEstimatedMmr', 'pfMmr');
  await verifyLookupAndFill(staffDefinition, createPage(staffDefinition), 'pf.dota2Id', 'dota2EstimatedMmr', 'mmr');

  const staffPage = createPage(staffDefinition);
  staffPage.setData({
    user: {
      nickname: '队员A',
      dota2Id: '12345',
      dota2RankTier: 75,
      dota2RankVerifiedAt: Date.now(),
      roles: [1],
      dota2LookupSnapshot: {
        accountId: '12345',
        rankTier: 75,
        verifiedAt: Date.now(),
        recentStats: { total: 0 },
        commonHeroes: [],
      },
    },
  });
  staffDefinition.onEditProfile.call(staffPage);
  assert.strictEqual(staffPage.data.pf.dota2EstimatedMmr, 5420, '已校验的超凡5应显示 5420 分');
  staffDefinition.onUseEstimatedMmr.call(staffPage);
  assert.strictEqual(staffPage.data.pf.mmr, '5420');

  const snapshotTime = Date.now();
  const snapshotPage = createPage(staffDefinition);
  snapshotPage.setData({
    user: {
      nickname: '快照玩家',
      dota2Id: '12345',
      dota2RankTier: 43,
      dota2RankVerifiedAt: snapshotTime,
      roles: [1],
      dota2LookupSnapshot: {
        accountId: '12345',
        nickname: 'OpenDota 快照玩家',
        avatarUrl: 'https://cdn.example/snapshot.jpg',
        rankTier: 43,
        verifiedAt: snapshotTime,
        recentStats: { total: 2, wins: 2, losses: 0, kda: 5.5 },
        commonHeroes: [{ name: 'Axe', games: 12 }],
      },
    },
  });
  staffDefinition.onEditProfile.call(snapshotPage);
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.nickname, 'OpenDota 快照玩家');
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.recentRecordText, '近 2 场 · 2 胜 0 负');
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.isExpired, false);
  staffDefinition.onPfDotaId.call(snapshotPage, { detail: { value: '67890' } });
  assert.strictEqual(snapshotPage.data.pf.dotaLookup, null, '切换 ID 后应清除旧快照');
  staffDefinition.onPfDotaId.call(snapshotPage, { detail: { value: '12345' } });
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.nickname, 'OpenDota 快照玩家', '切回原 ID 后应恢复快照');

  const expiredPage = createPage(staffDefinition);
  const expiredTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
  expiredPage.setData({
    user: {
      nickname: '过期玩家',
      dota2Id: '12345',
      dota2RankTier: 43,
      dota2RankVerifiedAt: expiredTime,
      roles: [1],
      dota2LookupSnapshot: {
        accountId: '12345',
        nickname: '过期快照',
        rankTier: 43,
        verifiedAt: expiredTime,
        recentStats: { total: 0 },
        commonHeroes: [],
      },
    },
  });
  staffDefinition.onEditProfile.call(expiredPage);
  assert.strictEqual(expiredPage.data.pf.dotaRankVerified, false);
  assert.strictEqual(expiredPage.data.pf.dotaLookup.isExpired, true, '过期快照仍应显示并标记过期');
  assert.strictEqual(expiredPage.data.pf.dota2EstimatedMmr, null, '过期快照不能直接用于填写天梯分');

  const fallbackPage = createPage(staffDefinition);
  fallbackPage.setData({
    user: {
      nickname: '老资料玩家',
      dota2Id: '12345',
      dota2RankTier: 43,
      dota2RankVerifiedAt: Date.now(),
      roles: [1],
    },
  });
  staffDefinition.onEditProfile.call(fallbackPage);
  assert.strictEqual(fallbackPage.data.lookingUpDota, true, '没有快照的老资料应自动补校验');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(fallbackPage.data.pf.dotaLookup.nickname, '测试玩家', '自动校验后应默认显示结果卡片');
  assert.strictEqual(fallbackPage.data.lookingUpDota, false);
  assert.strictEqual(fallbackPage.data.user.dota2LookupSnapshot.accountId, '12345', '自动保存后应同步本地用户快照');
  assert.strictEqual(fallbackPage.data.user.nickname, '老资料玩家', '自动保存不应覆盖其他资料');
  assert.strictEqual(fallbackPage.data.pf.originalDota2Id, '12345');

  api.call = () => { throw new Error('已有自动保存快照时不应再次请求 OpenDota'); };
  staffDefinition.onEditProfile.call(fallbackPage);
  assert.strictEqual(fallbackPage.data.lookingUpDota, false);
  assert.strictEqual(fallbackPage.data.pf.dotaLookup.nickname, '测试玩家', '重新打开应直接显示自动保存的快照');

  console.log('Profile rank estimate layout and interaction tests passed.');
})().finally(() => {
  api.call = originalCall;
  delete global.wx;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
