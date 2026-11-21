const assert = require('assert');
const fs = require('fs');
const path = require('path');
const api = require('../../utils/api');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
assert(app.pages.includes('pages/blacklist/blacklist'));
const nav = fs.readFileSync(path.join(__dirname, '../../components/nav-bar/index.wxml'), 'utf8');
assert(nav.includes('bindtap="goBlacklist"'));
assert(nav.includes('>黑名单</text>'));
const staff = fs.readFileSync(path.join(__dirname, '../staff/staff.wxml'), 'utf8');
assert(staff.includes('bindtap="onOpenBanEditor"'));
assert(staff.includes("{{item.ban ? '调整禁赛' : '禁赛'}}"));
assert(staff.includes('<ban-editor'));
const registration = fs.readFileSync(path.join(__dirname, '../../../cloudfunctions/dota2/actions/registration.js'), 'utf8');
assert(registration.includes('getActiveBlacklistRecord(db, openid)'));
assert(registration.includes('banNotice(activeBan)'), '报名入口必须展示禁赛期限和原因');

let definition = null;
global.Page = (value) => { definition = value; };
require('./blacklist.js');
delete global.Page;

const originalCall = api.call;
global.wx = { stopPullDownRefresh() {}, showToast() {}, showModal() {} };
const serverTime = Date.UTC(2026, 10, 21, 4, 0, 0);
api.call = (action) => {
  assert.strictEqual(action, 'listBlacklist');
  return Promise.resolve({
    isSuper: true,
    total: 1,
    serverTime,
    items: [{
      openid: 'user-a',
      nickname: '队员A',
      dota2Id: '123456',
      duration: '1w',
      durationText: '一周',
      permanent: false,
      reason: '迟到',
      startAt: serverTime,
      endAt: serverTime + 7 * 24 * 60 * 60 * 1000,
    }],
  });
};
const page = {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; }); },
};

definition.load.call(page).then(() => {
  assert.strictEqual(page.data.items.length, 1);
  assert.strictEqual(page.data.items[0].remainingText, '剩余 7 天');
  assert.strictEqual(page.data.isSuper, true);
  definition.onOpenEditor.call(page, { currentTarget: { dataset: { openid: 'user-a' } } });
  assert.strictEqual(page.data.editorVisible, true);
  assert.strictEqual(page.data.editorTarget.ban.duration, '1w', '调整禁赛应带入当前时长和原因');
  console.log('Blacklist navigation, management entry and page loading tests passed.');
}).finally(() => {
  api.call = originalCall;
  delete global.wx;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
