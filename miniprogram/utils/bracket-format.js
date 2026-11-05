// utils/bracket-format.js - 赛制定义（赛制选择交互由 components/bracket-type-sheet 承载）
const BRACKET_FORMATS = [
  {
    value: 'double',
    name: 'TI 双败赛制',
    hint: '输一场进败者组，仍可争冠',
    badge: 'TI 同款',
    rankText: '名次：冠军 · 亚军 · 季军（败者组决赛败者）',
  },
  {
    value: 'single',
    name: '单败赛制',
    hint: '输一场即淘汰，不设三四名赛',
    badge: '更快',
    rankText: '名次：冠军 · 亚军 · 第3-4名（不设三四名赛）',
  },
];

function bracketTypeOf(tournament) {
  return tournament && tournament.bracketType === 'single' ? 'single' : 'double';
}

function bracketFormatOf(tournament) {
  const type = bracketTypeOf(tournament);
  return BRACKET_FORMATS.find((item) => item.value === type) || BRACKET_FORMATS[0];
}

function bracketFormatName(tournament) {
  return bracketFormatOf(tournament).name;
}

module.exports = {
  BRACKET_FORMATS,
  bracketTypeOf,
  bracketFormatOf,
  bracketFormatName,
};
