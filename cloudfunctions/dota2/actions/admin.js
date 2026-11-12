/**
 * 超管用户管理动作。从原 index.js 拆出（纯搬移）。
 */
const { db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { isSuper, getAdminsConfig } = require('../permissions');
const { ADMIN_USER_SORT_FIELDS, buildAdminUsers, buildAdminRoster } = require('../admin-users');
const { ADMIN_USER_LIST_FIELDS } = require('../query-projections');

module.exports = {
  /* 超管：分页管理所有用户，排序按 Dota ID / 天梯分 / 用户名 / 已校验段位。 */
  async listUsers(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以查看用户列表');
    const cfg = await getAdminsConfig();
    const page = Math.max(1, Math.floor(Number(event.page) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(event.pageSize) || 20)));
    const sortBy = ADMIN_USER_SORT_FIELDS.indexOf(event.sortBy) >= 0 ? event.sortBy : 'nickname';
    const order = event.order === 'desc' ? 'desc' : 'asc';
    const records = [];
    let offset = 0;
    while (true) {
      const result = await db.collection('users')
        .field(ADMIN_USER_LIST_FIELDS)
        .orderBy('_id', 'asc')
        .skip(offset)
        .limit(100)
        .get();
      const batch = result.data || [];
      records.push(...batch);
      offset += batch.length;
      if (batch.length < 100) break;
    }
    const sortedUsers = buildAdminUsers(records, cfg.superAdmin, sortBy, order);
    const start = (page - 1) * pageSize;
    const users = sortedUsers.slice(start, start + pageSize);
    return ok({
      users,
      admins: Array.isArray(cfg.admins) ? cfg.admins : [],
      // 管理员名册（openid → 昵称）随列表一并返回，超管不用翻页就能看清当前有哪些普通管理员
      adminRoster: buildAdminRoster(cfg.admins, sortedUsers, cfg.superAdmin),
      page,
      pageSize,
      total: sortedUsers.length,
      hasMore: start + users.length < sortedUsers.length,
      sortBy,
      order,
    });
  },

  /* 超管：全量设置普通管理员列表（≤ 20 人；去重、过滤空、排除超管自身；幂等）。 */
  async setAdmins(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以设置普通管理员');
    const list = Array.isArray(event.openids) ? event.openids : [];
    const seen = new Set();
    const deduped = [];
    list.forEach((value) => {
      const item = String(value || '').trim();
      if (item && item !== openid && !seen.has(item)) {
        seen.add(item);
        deduped.push(item);
      }
    });
    if (deduped.length > 20) return fail('普通管理员最多 20 人');
    const cfg = await getAdminsConfig();
    const update = { admins: deduped, updatedAt: Date.now() };
    if (cfg && cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data: update });
    } else {
      await db.collection('config').add({
        data: Object.assign({ key: 'admins', superAdmin: cfg.superAdmin || '', createdAt: Date.now() }, update),
      });
    }
    return ok({ admins: deduped });
  },
};
