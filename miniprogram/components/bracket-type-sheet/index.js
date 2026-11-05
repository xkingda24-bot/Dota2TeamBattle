// components/bracket-type-sheet/index.js - 赛制选择底部弹层（生成对阵前的一次性选择）
const { BRACKET_FORMATS } = require('../../utils/bracket-format');

// 展示顺序：单败在前（赛程更快，先给一个轻量选项），双败在后
const SHEET_ORDER = ['single', 'double'];
const SHEET_FORMATS = SHEET_ORDER
  .map((value) => BRACKET_FORMATS.find((item) => item.value === value))
  .filter(Boolean);

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    formats: SHEET_FORMATS,
    picked: '',
    pickedName: '',
  },

  observers: {
    visible(open) {
      // 每次打开都不预选：这是不可逆操作，不应该有一键默认值
      if (open) this.setData({ picked: '', pickedName: '' });
    },
  },

  methods: {
    noop() {},

    onPick(e) {
      const value = e.currentTarget.dataset.value;
      const format = SHEET_FORMATS.find((item) => item.value === value);
      if (!format || value === this.data.picked) return;
      this.setData({ picked: value, pickedName: format.name });
      wx.vibrateShort({ type: 'light', fail: () => {} });
    },

    onConfirm() {
      const picked = this.data.picked;
      if (picked !== 'single' && picked !== 'double') return;
      this.triggerEvent('confirm', { bracketType: picked });
    },

    onCancel() {
      this.triggerEvent('cancel');
    },
  },
});
