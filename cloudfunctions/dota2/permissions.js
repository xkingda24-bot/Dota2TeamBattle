/**
 * 管理员与赛事权限判定。从原 index.js 拆出（纯搬移）。
 *
 * 最高管理员由环境变量指定的账号初始化；赛事权限按 createdBy（创建者）或最高管理员校验。
 * config 中存：{ key:'admins', superAdmin: openid }；旧 admins 字段仅为历史兼容数据。
 */
const { db } = require('./db');

async function getAdminsConfig() {
  const res = await db.collection('config').where({ key: 'admins' }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  return { key: 'admins', superAdmin: '' };
}

async function isSuper(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin;
}

/* 管理员判定：最高管理员或普通管理员（config.admins 列表，实时读取） */
async function isAdmin(openid) {
  if (!openid) return false;
  const cfg = await getAdminsConfig();
  if (openid === cfg.superAdmin) return true;
  return Array.isArray(cfg.admins) && cfg.admins.indexOf(openid) >= 0;
}

/* 终结性操作（删除/归档）：仅比赛创建者或最高管理员。普通管理员不可删除/归档他人比赛。 */
async function canDeleteTournament(tournament, openid) {
  if (!tournament || !openid) return false;
  if (await isSuper(openid)) return true;
  return !!tournament.createdBy && tournament.createdBy === openid;
}

/* 比赛权限：比赛创建者或管理员（超管/普通管理员）可以管理该比赛。旧赛事没有 createdBy 时，
 * 只允许管理员操作，避免把历史赛事意外开放给普通用户。 */
async function canManageTournament(tournament, openid) {
  if (!tournament || !openid) return false;
  if (await isAdmin(openid)) return true;
  return !!tournament.createdBy && tournament.createdBy === openid;
}

module.exports = { getAdminsConfig, isSuper, isAdmin, canDeleteTournament, canManageTournament };
