// utils/bracket-format.js - 赛制定义与「生成对阵」时的赛制选择
const BRACKET_FORMATS = [
  {
    value: 'double',
    name: 'TI 双败赛制',
    hint: '输一场进败者组，仍可争冠',
    actionLabel: 'TI 双败赛制 · 输一场进败者组仍可争冠',
  },
  {
    value: 'single',
    name: '单败赛制',
    hint: '输一场即淘汰，不设三四名赛',
    actionLabel: '单败赛制 · 输一场即淘汰，不设三四名赛',
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

/* 生成对阵前让用户选赛制；取消时不回调 */
function promptBracketType(callback) {
  if (typeof callback !== 'function') return;
  wx.showActionSheet({
    itemList: BRACKET_FORMATS.map((item) => item.actionLabel),
    success: (res) => {
      const picked = BRACKET_FORMATS[res.tapIndex];
      if (picked) callback(picked.value);
    },
    fail: () => {},
  });
}

module.exports = {
  BRACKET_FORMATS,
  bracketTypeOf,
  bracketFormatOf,
  bracketFormatName,
  promptBracketType,
};
