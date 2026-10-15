// pages/staff/staff.js - 管理员名单（所有用户可看；超管可管理）
const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    superAdmin: null,
    admins: [],
    isAdmin: false,
    isSuper: false,
    addNickname: '',
    adding: false,
  },

  onShow() {
    this.load();
  },

  load() {
    return api
      .call('getStaff')
      .then((d) => {
        this.setData({
          superAdmin: d.superAdmin,
          admins: d.admins || [],
          isAdmin: !!d.isAdmin,
          isSuper: !!d.isSuper,
          loading: false,
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onAddInput(e) {
    this.setData({ addNickname: e.detail.value });
  },

  add() {
    if (this.data.adding) return;
    const nickname = this.data.addNickname.trim();
    if (!nickname) {
      wx.showToast({ title: '请输入对方昵称', icon: 'none' });
      return;
    }
    this.setData({ adding: true });
    api
      .call('addAdmin', { nickname })
      .then(() => {
        wx.showToast({ title: '已添加管理员', icon: 'success' });
        this.setData({ addNickname: '', adding: false });
        this.load();
      })
      .catch((e) => {
        this.setData({ adding: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  remove(e) {
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    wx.showModal({
      title: '移除管理员',
      content: '确定移除 ' + nickname + ' 的管理员权限吗？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('removeAdmin', { openid })
            .then(() => {
              wx.showToast({ title: '已移除', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  initSuper() {
    wx.showModal({
      title: '初始化最高管理员',
      content: '你是本群的群主吗？系统还没有最高管理员，第一个初始化的人将成为最高管理员（可添加/移除管理员）。确定初始化？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('initSuperAdmin')
            .then(() => {
              wx.showToast({ title: '初始化成功', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },
});
