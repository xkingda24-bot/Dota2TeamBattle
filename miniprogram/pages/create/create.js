// pages/create/create.js - 创建比赛（管理员，可多场并行）
const api = require('../../utils/api');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

Page({
  data: {
    name: '',
    secret: '',
    date: '',
    time: '',
    nRange: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    nIndex: 6, // 默认 8 个队长
    kRange: [1, 2, 3, 4, 5],
    kIndex: 3, // 默认 每队 4 个队友
    N: 8,
    K: 4,
    submitting: false,
  },

  onLoad() {
    const now = new Date();
    this.setData({
      date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      time: pad(now.getHours()) + ':' + pad(now.getMinutes()),
    });
    api
      .call('getStaff')
      .then((d) => {
        if (!d.isAdmin) {
          wx.showModal({
            title: '需要管理员',
            content: '只有管理员可以创建比赛。若你已是管理员，请从主页右上角「管理员」查看名单。',
            showCancel: false,
            success: () => wx.navigateBack(),
          });
        }
      })
      .catch((e) => {
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },
  onSecret(e) {
    this.setData({ secret: e.detail.value });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },
  onN(e) {
    const i = Number(e.detail.value);
    this.setData({ nIndex: i, N: this.data.nRange[i] });
  },
  onK(e) {
    const i = Number(e.detail.value);
    this.setData({ kIndex: i, K: this.data.kRange[i] });
  },

  submit() {
    if (this.data.submitting) return;
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '请填写比赛名称', icon: 'none' });
      return;
    }
    const secret = this.data.secret.trim();
    if (!secret) {
      wx.showToast({ title: '请设置报名暗号', icon: 'none' });
      return;
    }
    const time = this.data.date + ' ' + this.data.time;
    this.setData({ submitting: true });
    api
      .call('createTournament', { name, time, secret, N: this.data.N, K: this.data.K })
      .then(() => {
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 700);
      })
      .catch((e) => {
        this.setData({ submitting: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },
});
