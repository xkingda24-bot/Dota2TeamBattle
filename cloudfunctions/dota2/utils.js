/**
 * 通用工具：响应包装 / 身份 / 集合初始化 / 文档更新 / 洗牌。
 * 从原 index.js 拆出（纯搬移）。
 */
const { cloud, db } = require('./db');
const { COLLECTIONS } = require('./constants');

function ok(data) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message };
}

function getOpenId() {
  const wc = cloud.getWXContext();
  return wc.OPENID || '';
}

async function ensureCollections() {
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
    } catch (e) {
      const code = String(e && (e.code || e.errCode) || '').toUpperCase();
      const message = String(e && e.message || '');
      if (!/ALREADY_EXIST|COLLECTION_EXIST/.test(code) && !/already exists|集合已存在/i.test(message)) throw e;
    }
  }
}

async function updateTournamentDoc(id, update) {
  const patch = update && update.data ? update.data : update;
  return db.collection('tournaments').doc(id).update({
    data: Object.assign({}, patch || {}, { updatedAt: Date.now() }),
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { ok, fail, getOpenId, ensureCollections, updateTournamentDoc, shuffle };
