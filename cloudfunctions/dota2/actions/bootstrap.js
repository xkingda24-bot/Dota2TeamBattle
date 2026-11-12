/**
 * 初始化与管理员引导动作。从原 index.js 拆出（纯搬移）。
 */
const { db } = require('../db');
const { ok, fail, getOpenId, ensureCollections } = require('../utils');
const { COLLECTIONS } = require('../constants');
const { canInitializeSuperAdmin } = require('../bootstrap');
const { normalizeCardStyle } = require('../cards');
const { getUser } = require('../users');
const { getAdminsConfig, isSuper, isAdmin } = require('../permissions');

module.exports = {
  /* 部署后一次性创建所需集合；普通业务请求不再执行集合初始化。 */
  async initializeDatabase() {
    const openid = getOpenId();
    const initialSuperAdminOpenid = String(process.env.INITIAL_SUPER_ADMIN_OPENID || '').trim();
    if (!canInitializeSuperAdmin(openid, '', initialSuperAdminOpenid)) {
      return fail('只有已配置的初始最高管理员可以初始化数据库');
    }
    await ensureCollections();
    return ok({ initialized: COLLECTIONS.slice() });
  },

  /* 初始化超管：仅允许环境变量指定的账号完成首次初始化。 */
  async initSuperAdmin() {
    const openid = getOpenId();
    const initialSuperAdminOpenid = String(process.env.INITIAL_SUPER_ADMIN_OPENID || '').trim();
    if (!initialSuperAdminOpenid) return fail('云函数未配置初始超管账号，请先设置 INITIAL_SUPER_ADMIN_OPENID');
    const cfg = await getAdminsConfig();
    if (cfg.superAdmin) return fail('最高管理员已初始化');
    if (!canInitializeSuperAdmin(openid, cfg.superAdmin, initialSuperAdminOpenid)) {
      return fail('当前微信账号不是指定的初始超管账号');
    }
    const me = await getUser(openid);
    if (!me) return fail('请先设置昵称再初始化');
    const data = { superAdmin: openid, createdAt: Date.now() };
    if (cfg._id) {
      await db.collection('config').doc(cfg._id).update({ data });
    } else {
      await db.collection('config').add({ data: Object.assign({ key: 'admins' }, data) });
    }
    return ok({ isSuper: true });
  },

  /* 最高管理员信息（所有用户可看）；超管可查看用户列表 */
  async getStaff() {
    const openid = getOpenId();
    const cfg = await getAdminsConfig();
    const ids = [cfg.superAdmin].filter(Boolean);
    const members = [];
    for (const id of ids) {
      const u = await getUser(id);
      members.push({ openid: id, nickname: u ? u.nickname : '未设置昵称' });
    }
    const user = await getUser(openid);
    if (user) user.cardStyle = normalizeCardStyle(user.cardStyle);
    return ok({
      user,
      superAdminOpenid: cfg.superAdmin,
      superAdmin: members.find((m) => m.openid === cfg.superAdmin) || null,
      isSuper: await isSuper(openid),
      isAdmin: await isAdmin(openid),
      admins: Array.isArray(cfg.admins) ? cfg.admins : [],
      bootstrapOpenid: cfg.superAdmin ? '' : openid,
      canInitializeSuperAdmin: canInitializeSuperAdmin(
        openid,
        cfg.superAdmin,
        process.env.INITIAL_SUPER_ADMIN_OPENID
      ),
    });
  },
};
