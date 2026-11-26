const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const indexWxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');
const indexJs = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
const historyJs = fs.readFileSync(path.join(root, 'pages/history/history.js'), 'utf8');
const historyWxml = fs.readFileSync(path.join(root, 'pages/history/history.wxml'), 'utf8');
assert(!indexWxml.includes('history-section') && !indexWxml.includes('历史赛事'), '主页不应再展示历史赛事区域');
assert(!indexJs.includes('listHistory') && !indexJs.includes('loadHistory'), '主页不应再请求历史列表');
assert(historyJs.includes('const PAGE_SIZE = 10;'));
assert(!historyJs.includes('onReachBottom') && !historyJs.includes('loadMore()'), '历史页不应再滚动加载');
assert(historyWxml.includes('上一页') && historyWxml.includes('下一页') && historyWxml.includes('每页 10 场'));
assert(historyWxml.includes('page-number') && historyWxml.includes('bindtap="goToPage"'), '应展示可点击的数字页码');

let definition;
global.Page = (options) => { definition = options; };
const calls = [];
global.wx = {
  cloud: {
    callFunction({ data }) {
      calls.push(data);
      const cursor = Number(data.cursorCreatedAt) || 0;
      const start = cursor === 0 ? 1 : cursor === 100 ? 11 : 21;
      const end = Math.min(start + 9, 25);
      const older = [];
      for (let value = start; value <= end; value += 1) {
        older.push({ id: 't' + value, name: '赛事' + value, status: 'finished', settled: true });
      }
      const hasMore = end < 25;
      return Promise.resolve({ result: { success: true, data: {
        older,
        hasMore,
        nextCursor: hasMore ? { createdAt: end * 10, id: 't' + end } : null,
        seasons: [],
        currentSeasonId: '2026Q4',
      } } });
    },
  },
};
require('./history.js');
delete global.Page;

function createPage() {
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update); },
  };
  return Object.assign(page, definition);
}

(async () => {
  const page = createPage();
  await page.loadFirstPage();
  assert.strictEqual(page.data.items.length, 10);
  assert.strictEqual(page.data.page, 1);
  assert.strictEqual(page.data.cursorStack.length, 1);
  assert.strictEqual(calls[0].limit, 10);
  assert.strictEqual(calls[0].cursorCreatedAt, 0);
  assert.deepStrictEqual(page.data.pageItems.map((item) => item.page), [1, 2]);

  await page.loadNextPage();
  assert.strictEqual(page.data.items[0].id, 't11');
  assert.strictEqual(page.data.items.length, 10);
  assert.strictEqual(page.data.page, 2);
  assert.strictEqual(calls[1].cursorCreatedAt, 100);
  assert.deepStrictEqual(page.data.pageItems.map((item) => item.page), [1, 2, 3]);

  await page.loadNextPage();
  assert.strictEqual(page.data.items[0].id, 't21');
  assert.strictEqual(page.data.items.length, 5);
  assert.strictEqual(page.data.page, 3);
  assert.strictEqual(page.data.hasMore, false);
  assert.deepStrictEqual(page.data.pageItems.map((item) => item.page), [1, 2, 3]);
  const callCountAtEnd = calls.length;
  await page.loadNextPage();
  assert.strictEqual(calls.length, callCountAtEnd, '最后一页不能继续向后翻');

  await page.loadPreviousPage();
  assert.strictEqual(page.data.items[0].id, 't11');
  assert.strictEqual(page.data.page, 2);
  await page.loadPreviousPage();
  assert.strictEqual(page.data.items[0].id, 't1');
  assert.strictEqual(page.data.page, 1);
  const callCountAtFirst = calls.length;
  await page.loadPreviousPage();
  assert.strictEqual(calls.length, callCountAtFirst, '第一页不能继续向前翻');

  await page.goToPage({ currentTarget: { dataset: { page: 3 } } });
  assert.strictEqual(page.data.page, 3);
  assert.strictEqual(page.data.items[0].id, 't21');
  assert.strictEqual(page.data.cursorStack.length, 3, '回跳不应丢失已知页码');
  await page.goToPage({ currentTarget: { dataset: { page: 1 } } });
  assert.strictEqual(page.data.page, 1);
  assert.strictEqual(page.data.items[0].id, 't1');
  assert.strictEqual(page.data.cursorStack.length, 3);
  assert.deepStrictEqual(page.data.pageItems.map((item) => item.page), [1, 2, 3]);

  page.setData({ seasonId: '2026Q4' });
  await page.loadNextPage();
  page.onSelectSeason({ currentTarget: { dataset: { id: '2026Q3' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(page.data.page, 1, '切换赛季后应回到第一页');
  assert.strictEqual(calls[calls.length - 1].cursorCreatedAt, 0);
  assert.strictEqual(calls[calls.length - 1].seasonId, '2026Q3');

  console.log('History 10-item cursor pagination and homepage history removal tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
