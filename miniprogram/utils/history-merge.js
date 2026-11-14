/**
 * 历史列表分页合并。
 *
 * 游标分页可能出现同一毫秒创建的赛事被两页同时覆盖，或「加载更多」重试时重复请求，
 * 这里按 id 去重合并，保证后端不需要为边界情况做额外补偿。
 */
function itemId(item) {
  return String((item && (item.id || item._id)) || '');
}

function mergeHistoryPage(existing, incoming, reset) {
  const list = Array.isArray(existing) ? existing : [];
  const next = Array.isArray(incoming) ? incoming : [];
  if (reset) return next.slice();
  const seen = new Set(list.map(itemId).filter(Boolean));
  const appended = [];
  next.forEach((item) => {
    const id = itemId(item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    appended.push(item);
  });
  return list.concat(appended);
}

module.exports = { itemId, mergeHistoryPage };
