/**
 * 云开发上下文：统一初始化 cloud / db / _，供各业务模块共用。
 * 从原 index.js 拆出（2026-11-12 模块化重构，纯搬移不改逻辑）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

module.exports = { cloud, db, _ };
