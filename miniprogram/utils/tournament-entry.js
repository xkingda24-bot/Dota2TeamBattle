// utils/tournament-entry.js - 比赛条目的统一入口路由
// 主页「今天的比赛」与「历史比赛」共用同一套路由：同一个赛事无论从哪个列表点进来，
// 都按它的当前状态落到同一个页面，不再有"历史详情页"这一层。

const STAGE_PAGES = {
  register: '/pages/register/register',
  draft: '/pages/draft/draft',
  bracket: '/pages/bracket/bracket',
};

/* 兼容云函数旧版返回的 `_id`，避免取不到赛事编号后静默失败。 */
function resolveId(item) {
  const raw = item ? (item.id || item._id) : '';
  if (typeof raw === 'string') return raw.trim();
  return raw === null || raw === undefined ? '' : String(raw);
}

/* 报名 -> 报名页；选人中 -> 队长选人模式进选人页、系统分组直接进比赛页；对战/已结束/已归档 -> 比赛页。 */
function resolveStage(item) {
  if (!item) return 'bracket';
  if (item.status === 'registration') return 'register';
  if (item.status === 'draft') return item.mode === 'auto' ? 'bracket' : 'draft';
  return 'bracket';
}

function buildUrl(item) {
  const id = resolveId(item);
  if (!id) return '';
  return STAGE_PAGES[resolveStage(item)] + '?id=' + encodeURIComponent(id);
}

/* 报名阶段需要暗号：比赛管理者、已报名、本机已验证过暗号的人直接进入。 */
function requiresSecret(item, hasStoredSecret) {
  if (resolveStage(item) !== 'register') return false;
  return !(item.canManage || item.meRegistered || hasStoredSecret);
}

module.exports = { resolveId, resolveStage, buildUrl, requiresSecret };
