const DEFAULT_CARD_STYLE = {
  background: 'arena',
  border: 'gold',
  font: 'standard',
  color: 'gold',
  animation: 'none',
};

const CARD_STYLE_OPTIONS = {
  backgrounds: [
    { id: 'arena', label: '天辉战场' },
    { id: 'dire', label: '夜魇深渊' },
    { id: 'ice', label: '冰封王座' },
    { id: 'arcane', label: '奥术星界' },
    { id: 'river', label: '河道涟漪' },
    { id: 'forest', label: '幽暗密林' },
    { id: 'lava', label: '熔岩裂谷' },
    { id: 'moon', label: '月蚀之夜' },
    { id: 'desert', label: '沙漠遗迹' },
  ],
  borders: [
    { id: 'gold', label: 'TI 金饰' },
    { id: 'rune', label: '符文边框' },
    { id: 'steel', label: '战斗钢纹' },
    { id: 'ember', label: '熔火边框' },
    { id: 'frost', label: '冰霜边框' },
    { id: 'toxic', label: '毒蛇边框' },
    { id: 'dire', label: '夜魇边框' },
    { id: 'radiant', label: '天辉边框' },
    { id: 'shadow', label: '暗影边框' },
    { id: 'pearl', label: '珍珠边框' },
  ],
  fonts: [
    { id: 'standard', label: '战术简洁' },
    { id: 'serif', label: '典藏铭文' },
    { id: 'rune', label: '秘法字形' },
    { id: 'bold', label: '重装黑体' },
    { id: 'light', label: '轻灵细体' },
    { id: 'italic', label: '疾风斜体' },
    { id: 'wide', label: '远征宽字' },
    { id: 'compact', label: '紧凑战术' },
    { id: 'mono', label: '符文等宽' },
    { id: 'round', label: '圆盾柔体' },
  ],
  colors: [
    { id: 'gold', label: '金色' },
    { id: 'arcane', label: '奥术紫' },
    { id: 'frost', label: '冰霜蓝' },
    { id: 'toxic', label: '毒蛇绿' },
    { id: 'ember', label: '余烬红' },
    { id: 'crimson', label: '深红' },
    { id: 'amber', label: '琥珀橙' },
    { id: 'pink', label: '桃花粉' },
    { id: 'pearl', label: '珍珠白' },
    { id: 'silver', label: '秘银灰' },
  ],
  animations: [
    { id: 'none', label: '静默战场', icon: '·' },
    { id: 'blink', label: '闪烁匕首', icon: '✦' },
    { id: 'bkb', label: '黑皇杖', icon: '◈' },
    { id: 'ward', label: '侦察守卫', icon: '◎' },
    { id: 'arcane', label: '奥术神符', icon: '⌘' },
    { id: 'blackhole', label: '黑洞', icon: '●' },
    { id: 'thunder', label: '雷神之怒', icon: 'ϟ' },
    { id: 'chronosphere', label: '时间结界', icon: '◴' },
    { id: 'reincarnation', label: '恢复神符', icon: '✚' },
    { id: 'sunstrike', label: '阳炎冲击', icon: '☀' },
    { id: 'freezingfield', label: '极寒领域', icon: '✣' },
    { id: 'omnislash', label: '无敌斩', icon: '╳' },
    { id: 'deathscythe', label: '死神镰刀', icon: '☾' },
    { id: 'ghostship', label: '幽灵船', icon: '≈' },
    { id: 'eclipse', label: '月蚀', icon: '◐' },
    { id: 'lagunablade', label: '神灭斩', icon: '↯' },
    { id: 'haunt', label: '鬼影重重', icon: '◍' },
    { id: 'chainfrost', label: '连环霜冻', icon: '❄' },
  ],
};

function normalizeCardStyle(style) {
  const source = style || {};
  const ids = {
    background: CARD_STYLE_OPTIONS.backgrounds,
    border: CARD_STYLE_OPTIONS.borders,
    font: CARD_STYLE_OPTIONS.fonts,
    color: CARD_STYLE_OPTIONS.colors,
    animation: CARD_STYLE_OPTIONS.animations,
  };
  const normalized = {};
  Object.keys(ids).forEach((field) => {
    const candidate = source[field];
    const allowed = ids[field].some((option) => option.id === candidate);
    normalized[field] = allowed ? candidate : DEFAULT_CARD_STYLE[field];
  });
  return normalized;
}

module.exports = {
  DEFAULT_CARD_STYLE,
  CARD_STYLE_OPTIONS,
  normalizeCardStyle,
};
