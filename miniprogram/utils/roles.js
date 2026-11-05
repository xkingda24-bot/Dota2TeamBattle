// 位次（1–5 号位）的统一规范化与文案
// 规则：五个位次全选折叠为「全能」，其余按顺序拼接成「1号位 / 3号位」这类文案。
// 注意：这里只影响展示文本，存储始终保留真实的 1–5 数组（分组均衡仍按位置覆盖计算）。
const ROLE_NUMS = [1, 2, 3, 4, 5];
const ROLE_LABELS = { 1: '1号位', 2: '2号位', 3: '3号位', 4: '4号位', 5: '5号位' };
const VERSATILE_LABEL = '全能';

// 过滤非法值、去重、升序，统一成数字数组
function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  const nums = roles
    .map((role) => Number(String(role).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

// 是否五个位次全选（等价于「全能」）
function hasAllRoles(roles) {
  return normalizeRoles(roles).length === ROLE_NUMS.length;
}

// 统一展示文案：全选 → 「全能」；否则按 separator 拼接（默认「、」）
function formatRolesText(roles, separator) {
  const nums = normalizeRoles(roles);
  if (!nums.length) return '';
  if (nums.length === ROLE_NUMS.length) return VERSATILE_LABEL;
  const sep = separator === undefined ? '、' : separator;
  return nums.map((n) => ROLE_LABELS[n]).join(sep);
}

// 历史/旧数据里可能已经把「全能」写进 rolesText，解析时按全选处理
function isVersatileText(text) {
  return typeof text === 'string' && text.indexOf(VERSATILE_LABEL) >= 0;
}

module.exports = {
  ROLE_NUMS,
  ROLE_LABELS,
  VERSATILE_LABEL,
  normalizeRoles,
  hasAllRoles,
  formatRolesText,
  isVersatileText,
};
