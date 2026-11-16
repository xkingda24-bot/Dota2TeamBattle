/**
 * 名片样式与报名名片字段。从原 index.js 拆出（纯搬移）。
 */
const { publicDotaCardFields } = require('./card-profile');

const DEFAULT_CARD_STYLE = {
  background: 'arena',
  border: 'gold',
  font: 'standard',
  color: 'gold',
  animation: 'none',
};
const CARD_STYLE_OPTIONS = {
  background: ['arena', 'dire', 'ice', 'arcane', 'river', 'forest', 'lava', 'moon', 'desert'],
  border: ['gold', 'rune', 'steel', 'ember', 'frost', 'toxic', 'dire', 'radiant', 'shadow', 'pearl'],
  font: ['standard', 'serif', 'rune', 'bold', 'light', 'italic', 'wide', 'compact', 'mono', 'round'],
  color: ['gold', 'arcane', 'frost', 'toxic', 'ember', 'crimson', 'amber', 'pink', 'pearl', 'silver'],
  animation: ['none', 'blink', 'bkb', 'ward', 'arcane', 'blackhole', 'thunder', 'chronosphere', 'reincarnation', 'sunstrike', 'freezingfield', 'omnislash', 'deathscythe', 'ghostship', 'eclipse', 'lagunablade', 'haunt', 'chainfrost'],
};

function normalizeCardStyle(style) {
  const source = style || {};
  const result = {};
  Object.keys(DEFAULT_CARD_STYLE).forEach((field) => {
    result[field] = CARD_STYLE_OPTIONS[field].indexOf(source[field]) >= 0 ? source[field] : DEFAULT_CARD_STYLE[field];
  });
  return result;
}

function registrationDotaFields(member) {
  return publicDotaCardFields(member && member.mmr, member, null);
}

module.exports = {
  DEFAULT_CARD_STYLE,
  CARD_STYLE_OPTIONS,
  normalizeCardStyle,
  registrationDotaFields,
};
