const assert = require('assert');
const fs = require('fs');
const path = require('path');

// mock 云函数 API，避免加载真实 utils/api 带来的环境依赖
const apiCalls = [];
const handlers = {};
const apiPath = require.resolve(path.join(__dirname, '../../utils/api.js'));
require.cache[apiPath] = {
  id: apiPath,
  filename: apiPath,
  loaded: true,
  exports: {
    call(name, params) {
      apiCalls.push({ name, params: params || {} });
      if (!handlers[name]) return Promise.reject(new Error('未 mock 的接口: ' + name));
      return handlers[name](params || {});
    },
  },
};

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
assert(app.pages.includes('pages/user-list/user-list'), 'app.json 应注册用户列表页');

const wxml = fs.readFileSync(path.join(__dirname, 'user-list.wxml'), 'utf8');
assert(wxml.includes('<nav-bar title="用户列表"'), '独立页面应使用带返回键的 nav-bar');
assert(!wxml.includes('class="mask"'), '用户列表不应再是弹窗');
assert(wxml.includes('<ban-editor'), '禁赛编辑器应随列表迁移');

const staffWxml = fs.readFileSync(path.join(__dirname, '../staff/staff.wxml'), 'utf8');
const staffJs = fs.readFileSync(path.join(__dirname, '../staff/staff.js'), 'utf8');
assert(!staffWxml.includes('userListModal'), 'staff 不应保留用户列表弹窗');
assert(!staffWxml.includes('ban-editor'), 'staff 不应保留禁赛编辑器');
assert(staffWxml.includes('bindtap="goUserList"'), 'staff 按钮应改为页面跳转');
assert(staffJs.includes("wx.navigateTo({ url: '/pages/user-list/user-list' })"), 'staff 应 navigateTo 到用户列表页');

let definition = null;
global.Page = (value) => { definition = value; };
require('./user-list.js');
delete global.Page;

const navigations = [];
global.wx = {
  navigateTo(options) { navigations.push(options.url); },
  showToast() {},
  showModal() {},
};

const createPage = () => {
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; }); },
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') page[key] = definition[key];
  });
  return page;
};
const callsTo = (name) => apiCalls.filter((c) => c.name === name);
const reset = () => { apiCalls.length = 0; navigations.length = 0; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
  // 1. 非超管：显示无权限，不请求用户列表
  reset();
  handlers.getStaff = () => Promise.resolve({ isSuper: false, admins: [] });
  let page = createPage();
  await definition.bootstrap.call(page);
  assert.strictEqual(page.data.forbidden, true, '非超管应显示无权限');
  assert.strictEqual(callsTo('listUsers').length, 0, '非超管不应请求用户列表');

  // 2. 超管：确认身份后按默认参数加载列表，并正确映射展示字段
  reset();
  handlers.getStaff = () => Promise.resolve({ isSuper: true, admins: ['admin-openid'] });
  handlers.listUsers = (params) => Promise.resolve({
    users: [
      { openid: 'admin-openid', nickname: '管理员', mmr: 5000, dota2Id: '12345', dota2RankVerified: true, dota2RankLabel: '超凡入圣' },
      { openid: 'user-openid', nickname: '', mmr: null, dota2Id: '', dota2RankVerified: false },
    ],
    total: 41,
    page: params.page,
    pageSize: params.pageSize,
    adminRoster: [{ openid: 'admin-openid', nickname: '管理员' }],
    createPermissionRoster: [],
  });
  page = createPage();
  await definition.bootstrap.call(page);
  assert.strictEqual(page.data.forbidden, false);
  assert.strictEqual(page.data.pageLoading, false);
  const firstListCall = callsTo('listUsers')[0];
  assert(firstListCall, '超管应请求用户列表');
  assert.deepStrictEqual(firstListCall.params, { page: 1, pageSize: 20, sortBy: 'nickname', order: 'asc', keyword: '' });
  assert.strictEqual(page.data.userListPageCount, 3, '41 位用户每页 20 应为 3 页');
  assert.strictEqual(page.data.userList[0].isAdminUser, true, '管理员名单中的用户应标记为管理员');
  assert.strictEqual(page.data.userList[0].mmrText, '天梯 5000');
  assert.strictEqual(page.data.userList[1].mmrText, '未填写天梯分');
  assert.strictEqual(page.data.userList[1].rankText, '未校验段位');
  assert.strictEqual(page.data.adminRoster.length, 1);

  // 3. 搜索：重置到第一页并携带关键字
  reset();
  definition.runUserSearch.call(page, '  abc ');
  await flush();
  const searchCall = callsTo('listUsers')[0];
  assert.strictEqual(searchCall.params.keyword, '  abc ');
  assert.strictEqual(searchCall.params.page, 1);

  // 4. 排序：同一字段升序→降序，换字段回到升序
  reset();
  definition.onChangeUserSort.call(page, { currentTarget: { dataset: { sort: 'nickname' } } });
  await flush();
  assert.strictEqual(callsTo('listUsers')[0].params.order, 'desc', '重复点击同字段应切换为降序');
  definition.onChangeUserSort.call(page, { currentTarget: { dataset: { sort: 'mmr' } } });
  await flush();
  const mmrCall = callsTo('listUsers')[1];
  assert.strictEqual(mmrCall.params.sortBy, 'mmr');
  assert.strictEqual(mmrCall.params.order, 'asc', '切换字段应回到升序');

  // 5. 分页边界：第一页不能上一页，最后一页不能下一页
  reset();
  page.data.userListPage = 1;
  definition.onChangeUserPage.call(page, { currentTarget: { dataset: { delta: -1 } } });
  assert.strictEqual(callsTo('listUsers').length, 0, '第一页不应再上一页');
  definition.onChangeUserPage.call(page, { currentTarget: { dataset: { delta: 1 } } });
  await flush();
  assert.strictEqual(callsTo('listUsers')[0].params.page, 2);
  page.data.userListPage = 3;
  definition.onChangeUserPage.call(page, { currentTarget: { dataset: { delta: 1 } } });
  assert.strictEqual(callsTo('listUsers').length, 1, '最后一页不应再下一页');

  // 6. 设为/取消管理员：全量提交 openids
  reset();
  handlers.setAdmins = (params) => Promise.resolve({ admins: params.openids });
  page.data.adminOpenids = ['admin-openid'];
  definition.onToggleAdmin.call(page, { currentTarget: { dataset: { openid: 'user-openid' } } });
  await flush();
  assert.deepStrictEqual(callsTo('setAdmins')[0].params.openids, ['admin-openid', 'user-openid']);
  definition.onToggleAdmin.call(page, { currentTarget: { dataset: { openid: 'admin-openid' } } });
  await flush();
  assert.deepStrictEqual(callsTo('setAdmins')[1].params.openids, ['user-openid']);

  // 7. 禁赛编辑器：普通用户可打开，超管用户不可打开
  page.data.banEditorVisible = false;
  page.data.userList = [
    { openid: 'super-openid', isSuper: true },
    { openid: 'user-openid', isSuper: false },
  ];
  definition.onOpenBanEditor.call(page, { currentTarget: { dataset: { openid: 'super-openid' } } });
  assert.strictEqual(page.data.banEditorVisible, false, '不能对最高管理员打开禁赛编辑器');
  definition.onOpenBanEditor.call(page, { currentTarget: { dataset: { openid: 'user-openid' } } });
  assert.strictEqual(page.data.banEditorVisible, true);
  assert.strictEqual(page.data.banTarget.openid, 'user-openid');

  // 8. staff 入口：goUserList 仅超管可跳转（跳转目标已在上方源码断言中验证）
  assert(/goUserList\(\) \{\s*if \(!this\.data\.isSuper\) return;/.test(staffJs), 'staff goUserList 应拦截非超管');

  console.log('User list page permission, loading, search, sort, pagination and admin tests passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
