const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { selectTabBar } = require('../utils/tab-bar');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
assert.strictEqual(app.tabBar.custom, true);
const configuredPaths = app.tabBar.list.map((item) => '/' + item.pagePath);

let definition = null;
global.Component = (value) => { definition = value; };
require('./index.js');
delete global.Component;
assert.deepStrictEqual(definition.data.list.map((item) => item.pagePath), configuredPaths);
assert.deepStrictEqual(definition.data.list.map((item) => item.text), ['主页', '禁赛名单', '历史赛事', '我的']);

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
