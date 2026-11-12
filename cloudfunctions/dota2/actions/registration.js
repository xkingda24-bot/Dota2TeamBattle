/**
 * 报名相关动作。从原 index.js 拆出（纯搬移）；
 * setTeamName 新增 UGC 内容安全检测（msgSecCheck）。
 * syncMatchNames 原来挂在 actions 对象上仅供内部调用，现改为模块内普通函数。
 */
const { cloud, db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { getUser } = require('../users');
const { registrationDotaFields } = require('../cards');
const { canManageTournament, isAdmin } = require('../permissions');
const { getTournamentById, requireTournamentManager } = require('../tournaments');
const { buildRegistration, skipRegistrationSecret } = require('../registration');
const { mutateTournament } = require('../tournament-transaction');
const { TEAM_LOGO_IDS } = require('../team-logos');
const { checkUserText } = require('../content-security');

// scene 取值以官方文档为准：1 资料 / 2 评论 / 3 正文 / 4 昵称
const SCENE_CONTENT = 3;

/* 队伍改名后同步对阵快照：晋级图/赛程列表按 match.teamX 的 name/teamIcon 展示，需与新队名一致 */
function syncMatchNames(t, teamIndex, captain) {
  const seeding = Array.isArray(t.seeding) ? t.seeding : (t.teams || []).map((_, i) => i);
  const slot = seeding.indexOf(teamIndex);
  const slotOpenid = 'T' + (slot >= 0 ? slot : teamIndex);
  return (t.matches || []).map((m) => {
    const nm = Object.assign({}, m);
    ['teamA', 'teamB'].forEach((side) => {
      const src = nm[side];
      if (src && src.type === 'team' && src.openid === slotOpenid) {
        nm[side] = Object.assign({}, src, { name: captain.teamName || '', teamIcon: captain.teamIcon || '' });
      }
    });
    return nm;
  });
}

module.exports = {
  /* 报名（需暗号）：队长/队员/替补；队员满时自动进入替补；资料（昵称/天梯分/常玩位置）必填才可报名 */
  async register(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me || !me.nickname) return fail('请先设置昵称');
    if (me.mmr == null) return fail('请先在「我的-编辑资料」填写天梯分后再报名');
    if (!Array.isArray(me.roles) || me.roles.length === 0) return fail('请先在「我的-编辑资料」选择常玩位置后再报名');
    const adminFlag = await isAdmin(openid);
    const result = await mutateTournament(db, event.id, (t) => {
      // 管理员或本场创建者免暗号，与报名页「创建者进入无需验证暗号」的文案一致
      const skipSecret = skipRegistrationSecret(t, openid, adminFlag);
      const registration = buildRegistration(
        t, openid, me, event.role, event.secret, registrationDotaFields(me), Date.now(), skipSecret
      );
      if (registration.error) return registration;
      return { data: { registrations: registration.registrations }, result: registration.result };
    });
    return result.error ? fail(result.error) : ok(Object.assign({}, result.result, { updatedAt: result.updatedAt }));
  },

  /* 设置队伍名称（队长本人/组长本人或本场比赛管理者；最多 10 个字） */
  async setTeamName(event) {
    const openid = getOpenId();
    const teamName = String(event.teamName || '').trim();
    if (teamName.length > 10) return fail('队伍名称最多 10 个字');
    const hasTeamIcon = Object.prototype.hasOwnProperty.call(event, 'teamIcon');
    const teamIcon = hasTeamIcon ? String(event.teamIcon || '').trim() : null;
    if (hasTeamIcon && teamIcon && TEAM_LOGO_IDS.indexOf(teamIcon) < 0) return fail('请选择内置队标');
    const targetOpenid = String(event.openid || '') || openid;
    const currentTournament = await getTournamentById(event.id);
    if (!currentTournament) return fail('比赛不存在');
    const manager = await canManageTournament(currentTournament, openid);
    if (targetOpenid !== openid && !manager) return fail('只有队长本人或比赛创建者、最高管理员可以设置队伍名称');

    // UGC 内容安全检测：队名会在对阵图与赛程中公开展示
    if (teamName) {
      const check = await checkUserText(cloud, targetOpenid, SCENE_CONTENT, teamName);
      if (!check.ok) return fail(check.message);
    }

    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode === 'auto') {
        if (t.status !== 'draft' && t.status !== 'battle') return { error: '只有分组完成后可以设置队伍名称' };
        const teams = (t.teams || []).map((tm) => Object.assign({}, tm));
        const ti = teams.findIndex((tm) => tm.captain && tm.captain.openid === targetOpenid);
        if (ti < 0) return { error: '只能由组长（本队天梯分最高者）或本场比赛管理者设置队伍名称' };
        teams[ti] = Object.assign({}, teams[ti], {
          captain: Object.assign({}, teams[ti].captain, Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {})),
        });
        return { data: { teams, matches: syncMatchNames(t, ti, teams[ti].captain) }, result: true };
      }
      if (t.status === 'registration') {
        const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
        const idx = registrations.findIndex((r) => r.openid === targetOpenid && r.role === 'captain');
        if (idx < 0) return { error: '只能为已报名的队长设置队伍名称' };
        registrations[idx] = Object.assign({}, registrations[idx], Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {}));
        return { data: { registrations }, result: true };
      }
      if (t.status === 'draft' || t.status === 'battle') {
        const teams = (t.teams || []).map((tm) => Object.assign({}, tm));
        const ti = teams.findIndex((tm) => tm.captain && tm.captain.openid === targetOpenid);
        if (ti < 0) return { error: '只能由本队队长或本场比赛管理者设置队伍名称' };
        teams[ti] = Object.assign({}, teams[ti], {
          captain: Object.assign({}, teams[ti].captain, Object.assign({ teamName }, hasTeamIcon ? { teamIcon } : {})),
        });
        return { data: { teams, matches: syncMatchNames(t, ti, teams[ti].captain) }, result: true };
      }
      return { error: '当前阶段不能设置队伍名称' };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 比赛创建者或管理员：报名阶段把队员移入替补 / 替补移回队员 */
  async moveRegistration(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const toRole = event.toRole === 'player' ? 'player' : 'waitlist';
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以调整名单' };
      const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
      const idx = registrations.findIndex((r) => r.openid === event.openid);
      if (idx < 0) return { error: '未找到该报名' };
      const cur = registrations[idx];
      if (cur.role !== 'player' && cur.role !== 'waitlist') return { error: '只能调整队员/替补' };
      if (cur.role === toRole) return { error: '该用户已在目标名单中' };
      if (toRole === 'player') {
        const players = registrations.filter((r) => r.role === 'player').length;
        if (players >= t.N * t.K) return { error: '队员名额已满，无法移入' };
      } else {
        const waitLimit = t.waitLimit || 0;
        if (waitLimit <= 0) return { error: '本场比赛未设置替补' };
        const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
        if (waitlist >= waitLimit) return { error: '替补名额已满' };
      }
      registrations[idx] = Object.assign({}, cur, { role: toRole });
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 退报（报名阶段自己取消；分组阶段替补本人也能取消，首发与队长仍锁定） */
  async cancelRegister(event) {
    const openid = getOpenId();
    const result = await mutateTournament(db, event.id, (t) => {
      const current = Array.isArray(t.registrations) ? t.registrations : [];
      const mine = current.find((r) => r && r.openid === openid);
      if (!mine) return { error: '你尚未报名' };
      const draftWaitlist = t.status === 'draft' && mine.role === 'waitlist';
      if (t.status !== 'registration' && !draftWaitlist) {
        return { error: '报名已锁定，请联系本场比赛创建者或管理员' };
      }
      const registrations = current.filter((r) => !(r && r.openid === openid));
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 移除报名（比赛创建者或最高管理员） */
  async removeRegistration(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const result = await mutateTournament(db, event.id, (t) => {
      const current = Array.isArray(t.registrations) ? t.registrations : [];
      const registrations = current.filter((r) => r.openid !== event.openid);
      if (registrations.length === current.length) return { error: '未找到该报名' };
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 比赛创建者或管理员：把某个替补移出替补席（报名、分组、对战阶段都可用） */
  async removeWaitlistRegistration(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const targetOpenid = String(event.openid || '');
    if (!targetOpenid) return fail('缺少要移除的替补');
    const result = await mutateTournament(db, event.id, (t) => {
      const current = Array.isArray(t.registrations) ? t.registrations : [];
      const target = current.find((registration) => registration && registration.openid === targetOpenid && registration.role === 'waitlist');
      if (!target) return { error: '该玩家不在替补席' };
      const registrations = current.filter((registration) => !(registration && registration.openid === targetOpenid));
      return { data: { registrations }, result: true };
    });
    return result.error ? fail(result.error) : ok(true);
  },
};
