/**
 * 全局常量。从原 index.js 拆出（纯搬移）。
 */
module.exports = {
  COLLECTIONS: ['users', 'tournaments', 'config', 'blacklist'],
  BO_LIST: ['BO1', 'BO3', 'BO5'],
  MAX_N: 16,
  MAX_K: 5,
  DOTA_ID_RE: /^\d{5,12}$/,
  DOTA_CACHE_TTL: 5 * 60 * 1000,
  DOTA_CACHE_MAX: 500,
  DOTA_LOOKUP_LIMIT: 5,
  DOTA_LOOKUP_WINDOW: 60 * 1000,
  // 赛后感言以比赛文档内嵌数组保存：每位用户一条，可重复提交更新；
  // 上限和长度限制避免把比赛文档无限增大，也与 Web 版的交互保持一致。
  MAX_COMMENT_LENGTH: 100,
  MAX_COMMENTS: 100,
  BRACKET_TYPES: ['single', 'singleRank', 'double', 'pick8'],
};
