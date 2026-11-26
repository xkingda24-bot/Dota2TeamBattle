const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { selectTabBar } = require('../utils/tab-bar');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
assert.strictEqual(app.tabBar.custom, true);
assert.strictEqual(app.window.backgroundColorBottom, '#0d1017', '底部窗口背景应与导航栏一致');
const wxml = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8');
assert(wxml.includes('style="height: {{safeAreaBottom}}px;"'), '安全区应使用真机计算高度');
assert(wxss.includes('background: #0d1017'), '导航栏及安全区应使用不透明深色背景');
const configuredPaths = app.tabBar.list.map((item) => '/' + item.pagePath);

let definition = null;
global.Component = (value) => { definition = value; };
require('./index.js');
delete global.Component;
assert.deepStrictEqual(definition.data.list.map((item) => item.pagePath), configuredPaths);
assert.deepStrictEqual(definition.data.list.map((item) => item.text), ['主页', '禁赛名单', '历史赛事', '我的']);
assert(wxml.includes('tab-icon'), 'tab 应渲染图标');
definition.data.list.forEach((item) => {
  assert(item.icon.startsWith('data:image/svg+xml'), item.text + ' 缺少未选中图标');
  assert(item.iconActive.startsWith('data:image/svg+xml'), item.text + ' 缺少选中图标');
  assert(item.icon.includes('%238d96a3'), item.text + ' 未选中图标应使用灰色');
  assert(item.iconActive.includes('%23e8c27c'), item.text + ' 选中图标应使用金色');
});

const calls = [];
global.wx = { switchTab(options) { calls.push(options.url); } };
const tabBar = {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; }); },
};
tabBar.data.selected = 1;
definition.methods.switchTab.call(tabBar, { currentTarget: { dataset: { index: 1 } } });
assert.strictEqual(calls.length, 0, '重复点击当前 tab 不跳转');
definition.methods.switchTab.call(tabBar, { currentTarget: { dataset: { index: 3 } } });
assert.deepStrictEqual(calls, ['/pages/staff/staff']);

global.wx.getWindowInfo = () => ({ screenHeight: 844, safeArea: { bottom: 810 } });
definition.lifetimes.attached.call(tabBar);
assert.strictEqual(tabBar.data.safeAreaBottom, 34, '应保留 iPhone Home Indicator 的真实安全区高度');
global.wx.getWindowInfo = () => ({ screenHeight: 800, safeArea: { bottom: 800 } });
definition.lifetimes.attached.call(tabBar);
assert.strictEqual(tabBar.data.safeAreaBottom, 0, '无底部安全区时不应增加额外高度');

const page = { getTabBar: () => tabBar };
selectTabBar(page, 2);
assert.strictEqual(tabBar.data.selected, 2);
selectTabBar({}, 0);
selectTabBar({ getTabBar: () => null }, 0);

[
  ['pages/index/index.js', 0],
  ['pages/blacklist/blacklist.js', 1],
  ['pages/history/history.js', 2],
  ['pages/staff/staff.js', 3],
].forEach(([file, index]) => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert(source.includes('selectTabBar(this, ' + index + ')'), file + ' 未同步 tab 选中状态');
});

delete global.wx;
console.log('Custom tabBar routes, switching and selection tests passed.');
