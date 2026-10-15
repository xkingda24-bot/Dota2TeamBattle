// pages/staff/staff.js - 我的（资料 + 管理员名单；所有用户可看，超管可管理）
const api = require('../../utils/api');

const ROLE_LABELS = ['', '1号位', '2号位', '3号位', '4号位', '5号位'];

function fmtRoles(roles) {
  const arr = Array.isArray(roles) ? roles.filter((v) => v >= 1 && v <= 5) : [];
  return arr.length ? arr.map((v) => ROLE_LABELS[v]).join(' / ') : '';
}

function fmtMmr(mmr) {
  if (mmr === null || mmr === undefined || mmr === '') return '';
  return '天梯 ' + mmr;
}

Page({
  data: {
    loading: true,
    user: null,
    superAdmin: null,
    admins: [],
    isAdmin: false,
    isSuper: false,
    // 添加管理员：用户列表弹窗
    userListModal: false,
    userList: [],
    listLoading: false,
    // 资料编辑弹窗
    profileModal: false,
    pf: { nickname: '', mmr: '', roles: [], rolesActive: [false, false, false, false, false], signature: '' },
    saving: false,
  },

  onShow() {
    this.load();
  },

  load() {
    return api
      .call('getStaff')
      .then((d) => {
        const raw = d.user || null;
        const user = raw
          ? Object.assign({}, raw, {
              mmrText: fmtMmr(raw.mmr),
              rolesText: fmtRoles(raw.roles),
            })
          : null;
        this.setData({
          user,
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

  /* ---------- 添加管理员（从用户列表选取） ---------- */

  onOpenUserList() {
    this.setData({ userListModal: true, listLoading: true, userList: [] });
    api
      .call('listUsers')
      .then((d) => {
        const users = (d.users || []).map((u) =>
          Object.assign({}, u, {
            mmrText: u.mmr ? '天梯 ' + u.mmr : '',
            rolesText: fmtRoles(u.roles),
          })
        );
        this.setData({ userList: users, listLoading: false });
      })
      .catch((e) => {
        this.setData({ listLoading: false });
        wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  onPickUser(e) {
    const openid = e.currentTarget.dataset.openid;
    const nickname = e.currentTarget.dataset.nickname;
    wx.showModal({
      title: '添加管理员',
      content: '确定将 ' + nickname + ' 设为管理员吗？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('addAdmin', { openid })
            .then(() => {
              wx.showToast({ title: '已添加管理员', icon: 'success' });
              this.setData({ userListModal: false });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onCloseUserList() {
    this.setData({ userListModal: false });
  },

  /* ---------- 资料编辑 ---------- */

  onEditProfile() {
    const u = this.data.user || {};
    const roles = Array.isArray(u.roles) ? u.roles.filter((v) => v >= 1 && v <= 5) : [];
    const rolesActive = [false, false, false, false, false];
    roles.forEach((v) => (rolesActive[v - 1] = true));
    this.setData({
      profileModal: true,
      pf: {
        nickname: u.nickname || '',
        mmr: u.mmr === null || u.mmr === undefined || u.mmr === '' ? '' : String(u.mmr),
        roles,
        rolesActive,
        signature: u.signature || '',
      },
    });
  },

  onPfNick(e) {
    this.setData({ 'pf.nickname': e.detail.value });
  },

  onPfMmr(e) {
    this.setData({ 'pf.mmr': e.detail.value });
  },

  onPfSig(e) {
    this.setData({ 'pf.signature': e.detail.value });
  },

  onToggleRole(e) {
    const v = Number(e.currentTarget.dataset.role);
    const roles = this.data.pf.roles.slice();
    const rolesActive = this.data.pf.rolesActive.slice();
    const i = roles.indexOf(v);
    if (i >= 0) {
      roles.splice(i, 1);
      rolesActive[v - 1] = false;
    } else {
      roles.push(v);
      rolesActive[v - 1] = true;
    }
    this.setData({ 'pf.roles': roles.sort((a, b) => a - b), 'pf.rolesActive': rolesActive });
  },

  onSaveProfile() {
    if (this.data.saving) return;
    const pf = this.data.pf;
    const nickname = (pf.nickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (nickname.length > 20) {
      wx.showToast({ title: '昵称最多 20 个字', icon: 'none' });
      return;
    }
    const sig = (pf.signature || '').trim();
    if (sig.length > 15) {
      wx.showToast({ title: '个人签名最多 15 个字', icon: 'none' });
      return;
    }
    let mmr = '';
    if ((pf.mmr || '').trim() !== '') {
      mmr = Number(pf.mmr);
      if (!isFinite(mmr) || mmr < 0 || mmr > 20000) {
        wx.showToast({ title: '天梯分需在 0-20000 之间', icon: 'none' });
        return;
      }
      mmr = Math.round(mmr);
    }
    this.setData({ saving: true });
    api
      .call('saveProfile', { nickname, mmr, roles: this.data.pf.roles, signature: sig })
      .then(() => {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({ profileModal: false, saving: false });
        this.load();
      })
      .catch((err) => {
        this.setData({ saving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onCloseProfile() {
    if (this.data.saving) return;
    this.setData({ profileModal: false });
  },

  noop() {},

  /* ---------- 管理员 ---------- */

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
