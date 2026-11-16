const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../../utils/api');

const wxml = fs.readFileSync(path.join(__dirname, 'draft.wxml'), 'utf8');
assert(!wxml.includes('>选他</view>'), '可选队员区域不再显示独立「选他」按钮');
assert.strictEqual((wxml.match(/class="card draft-player-list"/g) || []).length, 1, '所有可选队员应共用一个名单卡片');
const candidateCard = wxml.match(/<view\s+class="draft-player-row"[^>]*>[\s\S]*?<player-card/);
assert(candidateCard, '未找到可选队员名片行');
assert(candidateCard[0].includes('bindtap="onPick"'), '整个可选队员名片行必须触发选人');
assert(candidateCard[0].includes('data-openid="{{item.openid}}"'));
assert(candidateCard[0].includes('data-name="{{item.nickname}}"'));
assert(wxml.includes('队长点击名片选择，管理员可代选'), '可选队员标题后必须说明点击选人方式');

let pageDefinition = null;
global.Page = (definition) => { pageDefinition = definition; };
require('./draft.js');
delete global.Page;

const remainingPlayers = [
  { openid: 'p0', nickname: '队员一', role: 'player' },
  { openid: 'p1', nickname: '队员二', role: 'player' },
  { openid: 'p2', nickname: '队员三', role: 'player' },
];
const originalCall = api.call;
api.call = () => Promise.resolve({
  id: 'tournament-1',
  status: 'draft',
  N: 2,
  K: 2,
  registrations: [],
  cardStyles: {},
  draftInfo: {
    done: true,
    remainingPlayers,
    picks: [],
  },
});

const page = {
  id: 'tournament-1',
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch, callback) {
    Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; });
    if (callback) callback();
  },
  computeDraft() {},
  redirectToBattle() {},
};

pageDefinition.load.call(page, true).then(() => {
  assert.strictEqual(page.data.t.draftInfo.remainingPlayers.length, 3);
  assert(
    page.data.t.draftInfo.remainingPlayers.every((player) => player.isCaptain === false),
    '所有可选正式队员都不能被数组下标误标为队长'
  );
  console.log('Draft remaining-player captain label regression test passed.');
}).finally(() => {
  api.call = originalCall;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
