const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wxml = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
assert(wxml.includes('nav-back'), '应渲染返回按钮');
assert(wxml.includes('bindtap="goBack"'), '返回按钮应绑定 goBack');
assert(wxml.includes('wx:if="{{showBack}}"'), '返回按钮应受 showBack 控制');

let definition = null;
global.Component = (value) => { definition = value; };
require('./index.js');
delete global.Component;

const createBar = () => ({
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; }); },
});

const mockWx = () => {
  const calls = { back: [], switchTab: [] };
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32 }),
    navigateBack(options) { calls.back.push(options.delta); },
    switchTab(options) { calls.switchTab.push(options.url); },
  };
  return calls;
};

// 1. 四个 tab 页是顶级入口，不显示返回键
[
  'pages/index/index',
  'pages/blacklist/blacklist',
  'pages/history/history',
  'pages/staff/staff',
].forEach((route) => {
  mockWx();
  global.getCurrentPages = () => [{ route }];
  const bar = createBar();
  definition.lifetimes.attached.call(bar);
  assert.strictEqual(bar.data.showBack, false, route + ' 不应显示返回键');
  assert.strictEqual(bar.data.statusBarHeight, 44);
  assert.strictEqual(bar.data.navHeight, 44, '导航高度应贴合胶囊按钮');
});

// 2. 二级页面显示返回键（含用户点名的历史比赛/用户列表/赛季积分）
[
  'pages/bracket/bracket',
  'pages/player/player',
  'pages/season-points/season-points',
  'pages/register/register',
  'pages/draft/draft',
].forEach((route) => {
  mockWx();
  global.getCurrentPages = () => [{ route: 'pages/history/history' }, { route }];
  const bar = createBar();
  definition.lifetimes.attached.call(bar);
  assert.strictEqual(bar.data.showBack, true, route + ' 应显示返回键');
});

// 3. 页面栈有上一页时返回上一页
{
  const calls = mockWx();
  global.getCurrentPages = () => [{ route: 'pages/history/history' }, { route: 'pages/bracket/bracket' }];
  const bar = createBar();
  definition.methods.goBack.call(bar);
  assert.deepStrictEqual(calls.back, [1], '应 navigateBack 返回上一页');
  assert.strictEqual(calls.switchTab.length, 0);
}

// 4. 分享/扫码直达二级页（页面栈仅一层）时兜底回首页
{
  const calls = mockWx();
  global.getCurrentPages = () => [{ route: 'pages/bracket/bracket' }];
  const bar = createBar();
  definition.lifetimes.attached.call(bar);
  assert.strictEqual(bar.data.showBack, true, '分享直达也应提供返回出口');
  definition.methods.goBack.call(bar);
  assert.strictEqual(calls.back.length, 0);
  assert.deepStrictEqual(calls.switchTab, ['/pages/index/index'], '应 switchTab 兜底回首页');
}

delete global.wx;
delete global.getCurrentPages;
console.log('Nav bar back button visibility and navigation tests passed.');
