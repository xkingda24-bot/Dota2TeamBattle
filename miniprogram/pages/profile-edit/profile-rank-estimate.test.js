const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../../utils/api');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
assert(app.pages.includes('pages/profile-edit/profile-edit'), 'app.json 应注册资料编辑页');
const profilePageWxml = fs.readFileSync(path.join(__dirname, './profile-edit.wxml'), 'utf8');
assert(profilePageWxml.includes('<nav-bar'), '独立页面应使用带返回键的 nav-bar');
assert(!profilePageWxml.includes('class="mask"'), '资料编辑不应再是弹窗');
const staffEntryWxml = fs.readFileSync(path.join(__dirname, '../staff/staff.wxml'), 'utf8');
const staffEntryJs = fs.readFileSync(path.join(__dirname, '../staff/staff.js'), 'utf8');
assert(!staffEntryWxml.includes('profileModal'), 'staff 不应保留资料编辑弹窗');
assert(staffEntryWxml.includes('bindtap="goProfileEdit"'), 'staff 编辑资料按钮应改为页面跳转');
assert(staffEntryJs.includes("wx.navigateTo({ url: '/pages/profile-edit/profile-edit' })"), 'staff 应 navigateTo 到资料编辑页');

const indexWxml = fs.readFileSync(path.join(__dirname, '../index/index.wxml'), 'utf8');
const { buildDotaLookupView } = require('../../utils/dota-lookup-view');
const profileWxml = fs.readFileSync(path.join(__dirname, './profile-edit.wxml'), 'utf8');

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
assertFormLayout(profileWxml, '{{pf.dota2Id}}');
assert.ok(indexWxml.includes('{{pfDotaLookup.estimatedMmrText}}'));
assert.ok(profileWxml.includes('{{pf.dotaLookup.estimatedMmrText}}'));

const immortalEstimate = buildDotaLookupView({
  accountId: '1', rankTier: 80, leaderboardRank: 1, mmrEstimate: 15320.4, verifiedAt: Date.now(),
});
assert.strictEqual(immortalEstimate.rankDisplayText, '冠绝(1名)');
assert.strictEqual(immortalEstimate.estimatedMmr, 15320);
assert.strictEqual(immortalEstimate.estimatedMmrText, '约 15320 分');
assert.strictEqual(immortalEstimate.estimateLabel, 'OpenDota 预估');
assert.strictEqual(immortalEstimate.canUseEstimatedMmr, true);

const rankedImmortal = buildDotaLookupView({ rankTier: 80, leaderboardRank: 500, verifiedAt: Date.now() });
assert.strictEqual(rankedImmortal.rankDisplayText, '冠绝(500名)');
assert.strictEqual(rankedImmortal.estimatedMmr, 8000);
assert.strictEqual(rankedImmortal.estimatedMmrText, '约 7500–8500 分');
assert.strictEqual(rankedImmortal.estimateLabel, '名次粗略预估');

const lowerRankedImmortal = buildDotaLookupView({ rankTier: 80, leaderboardRank: 2000, verifiedAt: Date.now() });
assert.strictEqual(lowerRankedImmortal.estimatedMmr, 6400);
assert.strictEqual(lowerRankedImmortal.estimatedMmrText, '约 6000–6800 分');

const unknownImmortal = buildDotaLookupView({ rankTier: 80, verifiedAt: Date.now() });
assert.strictEqual(unknownImmortal.estimatedMmr, null);
assert.strictEqual(unknownImmortal.estimatedMmrText, '5620+');
assert.strictEqual(unknownImmortal.estimateLabel, '冠绝起步分');
assert.strictEqual(unknownImmortal.canUseEstimatedMmr, false);

const ancient = buildDotaLookupView({ rankTier: 64, verifiedAt: Date.now() });
assert.strictEqual(ancient.estimatedMmr, 4312);
assert.strictEqual(ancient.estimatedMmrText, '4312 分');
assert.strictEqual(ancient.estimateLabel, '预估分');

const noPublicData = buildDotaLookupView({ rankTier: 64, recentStats: { total: 0 }, commonHeroes: [], verifiedAt: Date.now() });
assert.strictEqual(noPublicData.showPublicDataTip, true);
assert.strictEqual(buildDotaLookupView({
  rankTier: 64, recentStats: { total: 1, wins: 1 }, commonHeroes: [], verifiedAt: Date.now(),
}).showPublicDataTip, false, '只有常用英雄为空时不提示');
assert.strictEqual(buildDotaLookupView({
  rankTier: 64, recentStats: { total: 0 }, commonHeroes: [{ heroId: 2, games: 1 }], verifiedAt: Date.now(),
}).showPublicDataTip, false, '只有最近战绩为空时不提示');
assert.ok(indexWxml.includes('pfDotaLookup.showPublicDataTip'));
assert.ok(profileWxml.includes('pf.dotaLookup.showPublicDataTip'));
assert.ok(indexWxml.includes('请在dota2设置-社交-✅公开比赛数据'));
assert.ok(profileWxml.includes('请在dota2设置-社交-✅公开比赛数据'));

function loadDefinition(relativePath) {
  let definition = null;
  global.Page = (value) => { definition = value; };
  require(relativePath);
  delete global.Page;
  return definition;
}

const indexDefinition = loadDefinition('../index/index.js');
const profileDefinition = loadDefinition('./profile-edit.js');

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
  await verifyLookupAndFill(profileDefinition, createPage(profileDefinition), 'pf.dota2Id', 'dota2EstimatedMmr', 'mmr');

  const profilePage = createPage(profileDefinition);
  profilePage.setData({
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
  profileDefinition.initProfileForm.call(profilePage);
  assert.strictEqual(profilePage.data.pf.dota2EstimatedMmr, 5420, '已校验的超凡5应显示 5420 分');
  profileDefinition.onUseEstimatedMmr.call(profilePage);
  assert.strictEqual(profilePage.data.pf.mmr, '5420');

  const snapshotTime = Date.now();
  const snapshotPage = createPage(profileDefinition);
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
  profileDefinition.initProfileForm.call(snapshotPage);
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.nickname, 'OpenDota 快照玩家');
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.recentRecordText, '近 2 场 · 2 胜 0 负');
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.isExpired, false);
  profileDefinition.onPfDotaId.call(snapshotPage, { detail: { value: '67890' } });
  assert.strictEqual(snapshotPage.data.pf.dotaLookup, null, '切换 ID 后应清除旧快照');
  profileDefinition.onPfDotaId.call(snapshotPage, { detail: { value: '12345' } });
  assert.strictEqual(snapshotPage.data.pf.dotaLookup.nickname, 'OpenDota 快照玩家', '切回原 ID 后应恢复快照');

  const immortalSnapshotPage = createPage(profileDefinition);
  immortalSnapshotPage.setData({
    user: {
      nickname: '冠绝玩家',
      dota2Id: '88888',
      dota2RankTier: 80,
      dota2LeaderboardRank: 1,
      dota2RankVerifiedAt: Date.now(),
      roles: [1],
      dota2LookupSnapshot: {
        accountId: '88888', rankTier: 80, leaderboardRank: 1, mmrEstimate: 15320, verifiedAt: Date.now(),
      },
    },
  });
  profileDefinition.initProfileForm.call(immortalSnapshotPage);
  assert.strictEqual(immortalSnapshotPage.data.pf.dotaLookup.rankDisplayText, '冠绝(1名)');
  assert.strictEqual(immortalSnapshotPage.data.pf.dota2EstimatedMmr, 15320, '冠绝快照不能回退成统一的 5620');
  profileDefinition.onUseEstimatedMmr.call(immortalSnapshotPage);
  assert.strictEqual(immortalSnapshotPage.data.pf.mmr, '15320');

  const expiredPage = createPage(profileDefinition);
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
  profileDefinition.initProfileForm.call(expiredPage);
  assert.strictEqual(expiredPage.data.pf.dotaRankVerified, false);
  assert.strictEqual(expiredPage.data.pf.dotaLookup.isExpired, true, '过期快照仍应显示并标记过期');
  assert.strictEqual(expiredPage.data.pf.dota2EstimatedMmr, null, '过期快照不能直接用于填写天梯分');

  const fallbackPage = createPage(profileDefinition);
  fallbackPage.setData({
    user: {
      nickname: '老资料玩家',
      dota2Id: '12345',
      dota2RankTier: 43,
      dota2RankVerifiedAt: Date.now(),
      roles: [1],
    },
  });
  profileDefinition.initProfileForm.call(fallbackPage);
  assert.strictEqual(fallbackPage.data.lookingUpDota, true, '没有快照的老资料应自动补校验');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(fallbackPage.data.pf.dotaLookup.nickname, '测试玩家', '自动校验后应默认显示结果卡片');
  assert.strictEqual(fallbackPage.data.lookingUpDota, false);
  assert.strictEqual(fallbackPage.data.user.dota2LookupSnapshot.accountId, '12345', '自动保存后应同步本地用户快照');
  assert.strictEqual(fallbackPage.data.user.nickname, '老资料玩家', '自动保存不应覆盖其他资料');
  assert.strictEqual(fallbackPage.data.pf.originalDota2Id, '12345');

  api.call = () => { throw new Error('已有自动保存快照时不应再次请求 OpenDota'); };
  profileDefinition.initProfileForm.call(fallbackPage);
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
