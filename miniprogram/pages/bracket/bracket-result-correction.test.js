const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bracketWxml = fs.readFileSync(path.join(__dirname, 'bracket.wxml'), 'utf8');
const bracketJs = fs.readFileSync(path.join(__dirname, 'bracket.js'), 'utf8');
assert(
  /<view class="tree-node-admin" wx:if="{{nd.showAdmin && nd.status === 'done'}}">[\s\S]*?bindtap="resetResult"[\s\S]*?>修正结果<\/view>/.test(bracketWxml),
  '主晋级树已结束节点必须显示修正结果按钮'
);
assert(
  bracketJs.includes("showAdmin: t.canManage && !this.data.readonly && (t.status === 'battle' || t.status === 'finished')"),
  '整场结束后管理员仍应能修正赛果'
);
assert(
  bracketJs.includes("this._requestedView === 'battle' ? (t.status === 'battle' || t.status === 'finished')"),
  '整场结束后仍应允许显式返回对战视图'
);

let flowDefinition = null;
global.Component = (definition) => { flowDefinition = definition; };
require('../../components/tournament-flow/index.js');
delete global.Component;

function runFinishedBattleNavigation(canManage) {
  const redirects = [];
  const oldWx = global.wx;
  const oldGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: 'pages/bracket/bracket' }];
  global.wx = { redirectTo: (options) => redirects.push(options.url) };
  const component = {
    properties: {
      tournament: { id: 'tournament-1', status: 'finished', mode: 'auto', canManage },
      current: 'finished',
      displayStage: 'settlement',
      readonly: false,
      settlementReady: true,
    },
  };
  flowDefinition.methods.onStepTap.call(component, { currentTarget: { dataset: { index: 2 } } });
  global.wx = oldWx;
  global.getCurrentPages = oldGetCurrentPages;
  assert.strictEqual(redirects.length, 1);
  return redirects[0];
}

const managerUrl = runFinishedBattleNavigation(true);
assert(managerUrl.includes('view=battle'));
assert(!managerUrl.includes('readonly=1'), '管理员从结算返回对战时应保留修正赛果权限');
const ordinaryUrl = runFinishedBattleNavigation(false);
assert(ordinaryUrl.includes('readonly=1'), '普通用户回看已结束对战时仍应只读');

function runReadonlyRegistrationToDraftNavigation() {
  const redirects = [];
  const oldWx = global.wx;
  const oldGetCurrentPages = global.getCurrentPages;
  global.getCurrentPages = () => [{ route: 'pages/register/register' }];
  global.wx = { redirectTo: (options) => redirects.push(options.url) };
  const component = {
    properties: {
      tournament: { id: 'tournament-1', status: 'draft', mode: 'auto', canManage: true },
      current: 'draft',
      displayStage: 'registration',
      readonly: true,
      settlementReady: false,
    },
  };
  flowDefinition.methods.onStepTap.call(component, { currentTarget: { dataset: { index: 1 } } });
  global.wx = oldWx;
  global.getCurrentPages = oldGetCurrentPages;
  assert.strictEqual(redirects.length, 1);
  return redirects[0];
}

const draftUrl = runReadonlyRegistrationToDraftNavigation();
assert(draftUrl.includes('view=draft'));
assert(!draftUrl.includes('readonly=1'), '从只读报名页返回当前分组阶段时必须恢复管理按钮');

console.log('Bracket result correction entry and finished-tournament navigation tests passed.');
