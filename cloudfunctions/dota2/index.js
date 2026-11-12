/**
 * Dota2 群内比赛管理 - 云函数入口（路由）
 *
 * 所有业务逻辑都走这里（小程序端不直连数据库），
 * 身份取自微信 openid（wxContext.OPENID），天然免登录；
 * 最高管理员由环境变量指定的账号初始化；赛事权限按 createdBy（创建者）或最高管理员校验。
 *
 * 集合：users / tournaments / config（部署后通过 initializeDatabase 一次性创建）
 *  config 中存：{ key:'admins', superAdmin: openid }；旧 admins 字段仅为历史兼容数据。
 *
 * 2026-11-12 模块化重构：按域拆分至 actions/ 与各支撑模块，本文件只做动作路由。
 * 业务支撑模块：db / constants / utils / cards / dota-profile / users / permissions /
 *              tournaments / auto-group / content-security（UGC 内容安全检测）。
 */
const { fail } = require('./utils');

const bootstrap = require('./actions/bootstrap');
const home = require('./actions/home');
const profile = require('./actions/profile');
const admin = require('./actions/admin');
const tournament = require('./actions/tournament');
const registration = require('./actions/registration');
const draft = require('./actions/draft');
const bracket = require('./actions/bracket');
const grouping = require('./actions/grouping');
const testTools = require('./actions/test-tools');
const comments = require('./actions/comments');

const actions = Object.assign(
  {},
  bootstrap,
  home,
  profile,
  admin,
  tournament,
  registration,
  draft,
  bracket,
  grouping,
  testTools,
  comments
);

/* ---------------- 入口 ---------------- */

exports.main = async (event) => {
  try {
    const action = event.action || event.type;
    const fn = actions[action];
    if (!fn) return fail('未知操作：' + action);
    return await fn(event);
  } catch (e) {
    console.error('dota2 cloud function error:', e);
    return fail('服务异常：' + (e && e.message ? e.message : '未知错误'));
  }
};

/* 供单测校验动作清单（不参与线上调用） */
exports.actions = actions;
