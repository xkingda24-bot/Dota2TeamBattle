const { publicDotaCardFields } = require('./card-profile');

function buildRegistration(tournament, openid, member, requestedRole, secret, dotaFields, now, skipSecret) {
  const status = tournament && tournament.status;
  // 分组流程中（status=draft）替补席位未满时仍可报名替补：进入分组后迟到的玩家只能补替补，不能挤进首发。
  const draftStage = status === 'draft';
  if (!tournament || (status !== 'registration' && !draftStage)) return { error: '当前不在报名阶段' };
  // 分组阶段报名替补免暗号：能进到分组页的已是群内成员，非管理者页面也不展示暗号，再要求输入只会输错被拒。
  const skipSecretCheck = skipSecret || (draftStage && requestedRole === 'waitlist');
  if (!skipSecretCheck && String(secret || '') !== String(tournament.secret || '')) return { error: '报名暗号错误' };

  const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];
  if (registrations.some((registration) => registration && registration.openid === openid)) {
    return { error: '你已经报名过了' };
  }

  const waitLimit = Number(tournament.waitLimit) || 0;
  const captains = registrations.filter((registration) => registration.role === 'captain');
  const players = registrations.filter((registration) => registration.role === 'player');
  const waitlist = registrations.filter((registration) => registration.role === 'waitlist');
  let role = 'player';
  let auto = false;

  if (requestedRole === 'captain') {
    if (draftStage) return { error: '分组进行中，只能报名替补' };
    if (tournament.mode === 'auto') return { error: '本场比赛为系统分组模式，请报名队员或替补' };
    role = 'captain';
    if (captains.length >= tournament.N) return { error: '队长名额已满' };
  } else if (requestedRole === 'waitlist') {
    role = 'waitlist';
    if (waitLimit <= 0) return { error: '本场比赛未设置替补' };
    if (waitlist.length >= waitLimit) return { error: '替补名额已满' };
  } else {
    if (draftStage) return { error: '分组进行中，只能报名替补' };
    if (players.length >= tournament.N * tournament.K) {
      if (waitLimit <= 0) return { error: '队员名额已满' };
      if (waitlist.length >= waitLimit) return { error: '队员名额已满，替补也已满' };
      role = 'waitlist';
      auto = true;
    }
  }

  const registration = {
    openid,
    nickname: member.nickname,
    role,
    ts: Number(now) || Date.now(),
    mmr: member.mmr || null,
    ...(dotaFields || {}),
    roles: member.roles || [],
    signature: member.signature || '',
  };
  if (role === 'captain') {
    registration.teamName = '';
    registration.teamIcon = '';
  }

  const nextRegistrations = registrations.concat([registration]);
  return {
    registration,
    registrations: nextRegistrations,
    result: {
      role,
      auto,
      registration,
      captainFilled: nextRegistrations.filter((item) => item.role === 'captain').length,
      playerFilled: nextRegistrations.filter((item) => item.role === 'player').length,
      waitlistFilled: nextRegistrations.filter((item) => item.role === 'waitlist').length,
    },
  };
}

/* 报名免暗号判定：管理员，或本场比赛的创建者。
   报名页对 canManage（含创建者）不再显示暗号输入框，后端必须用同一口径放行，
   否则普通用户创建房间后自己报名会被判成「报名暗号错误」。 */
function skipRegistrationSecret(tournament, openid, isAdminFlag) {
  if (isAdminFlag) return true;
  return !!tournament && !!tournament.createdBy && tournament.createdBy === openid;
}

function syncRegistrationProfiles(registrations, profiles) {
  const source = Array.isArray(registrations) ? registrations : [];
  const byOpenid = profiles || {};
  let changed = false;
  const synced = source.map((registration) => {
    if (!registration || !registration.openid || !byOpenid[registration.openid]) return registration;
    const profile = byOpenid[registration.openid];
    const next = Object.assign({}, registration);
    ['nickname', 'mmr', 'roles', 'signature'].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(profile, field)) return;
      const value = profile[field];
      if (Array.isArray(value)) {
        if (JSON.stringify(next[field] || []) !== JSON.stringify(value)) changed = true;
      } else if (next[field] !== value) {
        changed = true;
      }
      next[field] = value;
    });
    const dotaFields = publicDotaCardFields(profile.mmr, profile, null);
    Object.keys(dotaFields).forEach((field) => {
      if (next[field] !== dotaFields[field]) changed = true;
      next[field] = dotaFields[field];
    });
    return next;
  });
  return { registrations: synced, changed };
}

module.exports = { buildRegistration, syncRegistrationProfiles, skipRegistrationSecret };
