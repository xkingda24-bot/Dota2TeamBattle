// pages/create/create.js - 创建比赛 / 管理员修改配置（id 存在时进入编辑模式）
const api = require('../../utils/api');

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

Page({
  data: {
    editMode: false,
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

  onLoad(options) {
    const now = new Date();
    this.setData({
      date: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
      time: pad(now.getHours()) + ':' + pad(now.getMinutes()),
    });

    // 编辑模式：管理员修改比赛配置
    if (options && options.id) {
      this.id = options.id;
      this.setData({ editMode: true });
      api
        .call('tournament', { id: options.id })
        .then((d) => {
          if (!d || !d.isAdmin) {
            wx.showModal({
              title: '需要管理员',
              content: '只有管理员可以修改比赛配置。',
              showCancel: false,
              success: () => wx.navigateBack(),
            });
            return;
          }
          const date = (d.time || '').slice(0, 10);
          const time = (d.time || '').slice(11, 16);
          const nIdx = this.data.nRange.indexOf(d.N);
          const kIdx = this.data.kRange.indexOf(d.K);
          this.setData({
            name: d.name || '',
            secret: d.secret || '',
            date: date || this.data.date,
            time: time || this.data.time,
            N: d.N,
            K: d.K,
            nIndex: nIdx >= 0 ? nIdx : this.data.nIndex,
            kIndex: kIdx >= 0 ? kIdx : this.data.kIndex,
          });
        })
        .catch((e) => {
          wx.showToast({ title: e.message, icon: 'none' });
        });
      return;
    }

    // 创建模式：管理员校验
    api
      .call('getStaff')
      .then((d) => {
        if (!d.isAdmin) {
          wx.showModal({
            title: '需要管理员',
            content: '只有管理员可以创建比赛。若你已是管理员，请从主页右上角「我的」查看名单。',
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
    const done = () => {
      wx.showToast({ title: this.data.editMode ? '已保存' : '创建成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    };
    if (this.data.editMode) {
      api
        .call('updateConfig', { id: this.id, name, time, secret, N: this.data.N, K: this.data.K })
        .then(done)
        .catch((e) => {
          this.setData({ submitting: false });
          wx.showToast({ title: e.message, icon: 'none' });
        });
      return;
    }
    api
      .call('createTournament', { name, time, secret, N: this.data.N, K: this.data.K })
      .then(done)
      .catch((e) => {
        this.setData({ submitting: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },
});
