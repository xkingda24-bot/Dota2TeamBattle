const assert = require('assert');
const Module = require('module');

const caller = 'super-user';
let superAllowed = false;
let stored = null;
let addCount = 0;
let updateCount = 0;
const db = {
  collection(name) {
    assert.strictEqual(name, 'blacklist');
    return {
      where(filter) {
        assert(filter.openid);
        return { limit: () => ({ get: async () => ({ data: stored && stored.openid === filter.openid ? [stored] : [] }) }) };
      },
      add: async ({ data }) => {
        addCount += 1;
        stored = Object.assign({ _id: 'ban-1' }, data);
        return { id: 'ban-1' };
      },
      doc(id) {
        assert.strictEqual(id, 'ban-1');
        return { update: async ({ data }) => { updateCount += 1; stored = Object.assign({}, stored, data); } };
      },
    };
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && /actions[\/\\]blacklist\.js$/.test(parent.filename)) {
    if (request === '../db') return { cloud: {}, db };
    if (request === '../utils') return {
      ok: (data) => ({ success: true, data }),
      fail: (message) => ({ success: false, message }),
      getOpenId: () => caller,
    };
    if (request === '../permissions') return { isSuper: async () => superAllowed };
    if (request === '../users') return { getUser: async (openid) => ({ openid, nickname: '队员A', dota2Id: '123456' }) };
    if (request === '../content-security') return { checkUserText: async () => ({ ok: true }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const actions = require('./actions/blacklist');
Module._load = originalLoad;

async function main() {
  const input = { targetOpenid: 'user-a', duration: '1w', reason: '多次迟到' };
  let result = await actions.setUserBan(input);
  assert.strictEqual(result.success, false);
  assert.strictEqual(addCount, 0, '非超管不能产生任何黑名单写入');

  superAllowed = true;
  result = await actions.setUserBan(input);
  assert.strictEqual(result.success, true);
  assert.strictEqual(addCount, 1);
  assert.strictEqual(stored.duration, '1w');
  assert.strictEqual(stored.reason, '多次迟到');
  assert.strictEqual(result.data.ban.durationText, '一周');

  // 重复设置更新同一用户的当前记录，不新增第二张黑名单卡片。
  const originalStartAt = stored.startAt;
  result = await actions.setUserBan(Object.assign({}, input, { duration: '2w', reason: '调整原因' }));
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.adjusted, true);
  assert.strictEqual(addCount, 1);
  assert.strictEqual(updateCount, 1);
  assert.strictEqual(stored.startAt, originalStartAt, '调整有效禁赛必须保留原开始时间');

  result = await actions.liftUserBan({ targetOpenid: 'user-a' });
  assert.strictEqual(result.data.lifted, true);
  assert(stored.liftedAt);
  const writesAfterLift = updateCount;
  result = await actions.liftUserBan({ targetOpenid: 'user-a' });
  assert.strictEqual(result.data.alreadyInactive, true);
  assert.strictEqual(updateCount, writesAfterLift, '重复解除不重复写入');

  superAllowed = false;
  result = await actions.liftUserBan({ targetOpenid: 'user-a' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(updateCount, writesAfterLift, '非超管解除也不能写入');
  console.log('Blacklist action permission, upsert, adjustment and lift tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
