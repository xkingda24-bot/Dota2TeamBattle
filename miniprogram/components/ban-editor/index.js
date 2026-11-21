const { formatDateTime } = require('../../utils/date-time');

const DAY_MS = 24 * 60 * 60 * 1000;
const DURATIONS = [
  { value: '2d', label: '2天', ms: 2 * DAY_MS },
  { value: '4d', label: '4天', ms: 4 * DAY_MS },
  { value: '1w', label: '一周', ms: 7 * DAY_MS },
  { value: '2w', label: '二周', ms: 14 * DAY_MS },
  { value: 'permanent', label: '永久', ms: null },
];

function effectText(duration, target) {
  const item = DURATIONS.find((option) => option.value === duration) || DURATIONS[0];
  const activeBan = target && target.ban;
  const startAt = activeBan && Number(activeBan.startAt) ? Number(activeBan.startAt) : Date.now();
  if (item.ms === null) return '永久禁赛，直至超级管理员手动解除。';
  const prefix = activeBan ? '按原禁赛开始时间重新计算，' : '从现在开始，';
  return prefix + '将于 ' + formatDateTime(startAt + item.ms) + ' 自动解除。';
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    target: { type: Object, value: null },
    saving: { type: Boolean, value: false },
  },

  data: {
    durations: DURATIONS,
    duration: '2d',
    reason: '',
    effectText: '',
  },

  observers: {
    'visible, target'(open) {
      if (!open) return;
      const ban = this.data.target && this.data.target.ban;
      const duration = ban && DURATIONS.some((item) => item.value === ban.duration) ? ban.duration : '2d';
      this.setData({
        duration,
        reason: ban ? String(ban.reason || '') : '',
        effectText: effectText(duration, this.data.target),
      });
    },
  },

  methods: {
    noop() {},
    onSelectDuration(e) {
      if (this.data.saving) return;
      const duration = String(e.currentTarget.dataset.value || '');
      if (!DURATIONS.some((item) => item.value === duration)) return;
      this.setData({ duration, effectText: effectText(duration, this.data.target) });
    },
    onReasonInput(e) {
      this.setData({ reason: String(e.detail.value || '') });
    },
    onCancel() {
      if (!this.data.saving) this.triggerEvent('cancel');
    },
    onSubmit() {
      if (this.data.saving) return;
      const target = this.data.target;
      const reason = String(this.data.reason || '').trim();
      if (!target || !target.openid) return;
      if (!reason) {
        wx.showToast({ title: '请填写禁赛原因', icon: 'none' });
        return;
      }
      const detail = { targetOpenid: target.openid, duration: this.data.duration, reason };
      if (this.data.duration !== 'permanent') {
        this.triggerEvent('submit', detail);
        return;
      }
      wx.showModal({
        title: '确认永久禁赛',
        content: '将永久禁止 ' + (target.nickname || '该用户') + ' 报名参赛，只能由超级管理员手动解除。确定继续？',
        confirmText: '确认禁赛',
        success: (result) => {
          if (result.confirm) this.triggerEvent('submit', detail);
        },
      });
    },
  },
});
