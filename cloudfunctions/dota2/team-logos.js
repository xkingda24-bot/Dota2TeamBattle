// Keep preset IDs stable because archived tournaments persist the selected ID.
const TEAM_LOGO_PRESETS = [
  { id: 'swords', name: '双刃', emoji: '⚔️' },
  { id: 'emblem', name: '徽记', emoji: '🛡️' },
  { id: 'dragon', name: '巨龙', emoji: '🐉' },
  { id: 'wolf', name: '战狼', emoji: '🐺' },
  { id: 'bat', name: '夜蝠', emoji: '🦇' },
  { id: 'phoenix', name: '凤凰', emoji: '🔥' },
  { id: 'skull', name: '骷髅', emoji: '💀' },
  { id: 'eagle', name: '雄鹰', emoji: '🦅' },
  { id: 'snake', name: '毒蛇', emoji: '🐍' },
  { id: 'tiger', name: '猛虎', emoji: '🐅' },
  { id: 'bear', name: '巨熊', emoji: '🐻' },
  { id: 'scorpion', name: '蝎子', emoji: '🦂' },
  { id: 'lion', name: '雄狮', emoji: '🦁' },
  { id: 'horse', name: '战马', emoji: '🐎' },
  { id: 'wings', name: '羽翼', emoji: '🪶' },
  { id: 'bolt', name: '闪电', emoji: '⚡' },
  { id: 'axe', name: '斧王', emoji: '🪓' },
  { id: 'archer', name: '猎弓', emoji: '🏹' },
  { id: 'rune', name: '奥术', emoji: '🔮' },
  { id: 'frost', name: '冰霜', emoji: '❄️' },
  { id: 'storm', name: '风暴', emoji: '🌪️' },
  { id: 'dire', name: '夜魇', emoji: '🌑' },
  { id: 'radiant', name: '天辉', emoji: '☀️' },
  { id: 'roshan', name: '肉山', emoji: '👹' },
  { id: 'ward', name: '眼位', emoji: '👁️' },
];

const TEAM_LOGO_IDS = TEAM_LOGO_PRESETS.map((item) => item.id);

module.exports = { TEAM_LOGO_PRESETS, TEAM_LOGO_IDS };
