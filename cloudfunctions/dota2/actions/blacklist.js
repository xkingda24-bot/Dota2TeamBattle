const { cloud, db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { isSuper } = require('../permissions');
const { getUser } = require('../users');
const { checkUserText } = require('../content-security');
const {
  isBanActive,
  buildBanRecord,
  publicBanView,
  listBlacklistRecords,
  findBlacklistRecord,
} = require('../blacklist');

module.exports = {
  /* 所有用户可查看当前禁赛名单；只有超管收到管理权限标识。 */
  async listBlacklist() {
    const openid = getOpenId();
    const now = Date.now();
    const records = (await listBlacklistRecords(db))
      .filter((record) => isBanActive(record, now))
      .sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));
    const items = await Promise.all(records.map(async (record) => {
      const user = await getUser(record.openid);
      return publicBanView(record, user);
    }));
    return ok({ items, total: items.length, isSuper: await isSuper(openid), serverTime: now });
  },

  /* 超管设置或调整禁赛。有效禁赛按原开始时间计算新期限；已解除/到期后重新开始。 */
  async setUserBan(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以设置禁赛');
    const targetOpenid = String(event.targetOpenid || '').trim();
    if (!targetOpenid) return fail('缺少目标用户');
    if (targetOpenid === openid) return fail('不能禁赛最高管理员自己');
    const target = await getUser(targetOpenid);
    if (!target) return fail('该用户还没有个人资料，无法设置禁赛');
    const reason = String(event.reason || '').trim();
    const check = await checkUserText(cloud, openid, 3, reason);
    if (!check.ok) return fail(check.message);
    const existing = await findBlacklistRecord(db, targetOpenid);
    const built = buildBanRecord({
      target: Object.assign({}, target, { openid: targetOpenid }),
      existing,
      duration: event.duration,
      reason,
      operatorOpenid: openid,
      now: Date.now(),
    });
    if (built.error) return fail(built.error);
    if (existing && existing._id) {
      await db.collection('blacklist').doc(existing._id).update({ data: built.record });
    } else {
      await db.collection('blacklist').add({ data: built.record });
    }
    return ok({ ban: publicBanView(built.record, target), adjusted: built.adjusted });
  },

  /* 超管解除禁赛；重复解除保持幂等，直接返回当前已解除状态。 */
  async liftUserBan(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以解除禁赛');
    const targetOpenid = String(event.targetOpenid || '').trim();
    if (!targetOpenid) return fail('缺少目标用户');
    const existing = await findBlacklistRecord(db, targetOpenid);
    if (!isBanActive(existing, Date.now())) return ok({ lifted: false, alreadyInactive: true });
    await db.collection('blacklist').doc(existing._id).update({
      data: { liftedAt: Date.now(), liftedBy: openid, updatedAt: Date.now() },
    });
    return ok({ lifted: true, alreadyInactive: false });
  },
};
