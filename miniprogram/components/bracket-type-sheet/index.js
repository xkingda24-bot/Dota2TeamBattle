// components/bracket-type-sheet/index.js - 赛制选择底部弹层（生成对阵前的一次性选择）
const { BRACKET_FORMATS, BRACKET_TYPES } = require('../../utils/bracket-format');

// 展示顺序：单败在前（赛程更快，先给一个轻量选项），单败排位赛、8 队挑选赛居中，双败在后
const SHEET_ORDER = ['single', 'singleRank', 'pick8', 'double'];

// 8 队挑选赛只有 8 支队伍时可用；其它数量直接不展示，避免选了再报错
function buildFormats(teamCount) {
  const count = Number(teamCount) || 0;
  return SHEET_ORDER
    .map((value) => BRACKET_FORMATS.find((item) => item.value === value))
    .filter(Boolean)
    .filter((item) => item.value !== 'pick8' || !count || count === 8)
    .map((item) => Object.assign({}, item, {
      lane1: item.value === 'single' ? '淘汰赛' : item.value === 'pick8' ? '第一轮' : '胜者组',
      lane2: item.value === 'singleRank' ? '名次赛' : item.value === 'pick8' ? '第二轮' : '败者组',
    }));
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    // 队伍数：用于判断「8 队挑选赛」是否可选（0 表示未知，先全部展示）
    teamCount: {
      type: Number,
      value: 0,
    },
  },

  data: {
    formats: buildFormats(0),
    picked: '',
    pickedName: '',
  },

  observers: {
    'visible, teamCount'(open) {
      // 每次打开都重新算可选赛制，且不预选：这是不可逆操作，不应该有一键默认值
      if (open) this.setData({ formats: buildFormats(this.data.teamCount), picked: '', pickedName: '' });
    },
  },

  methods: {
    noop() {},

    onPick(e) {
      const value = e.currentTarget.dataset.value;
      const format = this.data.formats.find((item) => item.value === value);
      if (!format || value === this.data.picked) return;
      this.setData({ picked: value, pickedName: format.name });
    },

    onConfirm() {
      const picked = this.data.picked;
      if (BRACKET_TYPES.indexOf(picked) < 0) return;
      this.triggerEvent('confirm', { bracketType: picked });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },
  },
});
