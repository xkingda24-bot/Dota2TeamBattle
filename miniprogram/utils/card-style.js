const DEFAULT_CARD_STYLE = {
  background: 'arena',
  border: 'gold',
  font: 'standard',
  color: 'gold',
  animation: 'none',
};

const CARD_STYLE_OPTIONS = {
  backgrounds: [
    { id: 'arena', label: '天辉战场', description: '暮色战场与远方烽火' },
    { id: 'dire', label: '夜魇深渊', description: '暗红深渊与熔岩余烬' },
    { id: 'ice', label: '冰封王座', description: '寒霜蓝光与冰晶纹理' },
    { id: 'arcane', label: '奥术星界', description: '深空星尘与秘法辉光' },
  ],
  borders: [
    { id: 'gold', label: 'TI 金饰' },
    { id: 'rune', label: '符文边框' },
    { id: 'steel', label: '战斗钢纹' },
  ],
  fonts: [
    { id: 'standard', label: '战术简洁' },
    { id: 'serif', label: '典藏铭文' },
    { id: 'rune', label: '秘法字形' },
  ],
  colors: [
    { id: 'gold', label: '金色' },
    { id: 'arcane', label: '奥术紫' },
    { id: 'frost', label: '冰霜蓝' },
    { id: 'toxic', label: '毒蛇绿' },
    { id: 'ember', label: '余烬红' },
  ],
  animations: [
    { id: 'none', label: '静默战场', description: '不播放动画', icon: '·' },
    { id: 'blink', label: '闪烁匕首', description: '紫色传送门与剑光', icon: '✦' },
    { id: 'bkb', label: '黑皇杖', description: '金色魔法免疫护幕', icon: '◈' },
    { id: 'ward', label: '侦察守卫', description: '绿色视野扫描', icon: '◎' },
    { id: 'illusion', label: '幻象法球', description: '两道幻象分离消散', icon: '◇' },
    { id: 'roshan', label: '肉山震地', description: '红色地面冲击环', icon: '◉' },
    { id: 'arcane', label: '奥术神符', description: '青色符文闪烁', icon: '⌘' },
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
