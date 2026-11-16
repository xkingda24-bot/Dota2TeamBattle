const { publicDotaCardFields } = require('./card-profile');
const { normalizeCardStyle } = require('./cards');

function buildRegistration(tournament, openid, member, requestedRole, secret, dotaFields, now, skipSecret) {
  const status = tournament && tournament.status;
  // 分组/对战流程中只能补报替补，不能挤进首发；是否上场仍由比赛管理者决定。
  const draftStage = status === 'draft';
  const battleStage = status === 'battle';
  if (!tournament || (status !== 'registration' && !draftStage && !battleStage)) return { error: '当前不在报名阶段' };
  if (battleStage && requestedRole !== 'waitlist') return { error: '对战阶段只能报名替补' };
  // 分组和对战阶段报名替补免暗号，与页面直接报名入口保持一致。
  const skipSecretCheck = skipSecret || ((draftStage || battleStage) && requestedRole === 'waitlist');
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
    cardStyle: normalizeCardStyle(member.cardStyle),
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

function replaceBattleCaptain(team, sourceRegistrations, outOpenid, inOpenid, replacementMember) {
  const registrations = (Array.isArray(sourceRegistrations) ? sourceRegistrations : [])
    .map((registration) => Object.assign({}, registration));
  const sourceTeam = team || {};
  const captainOpenid = typeof sourceTeam.captain === 'string'
    ? sourceTeam.captain
    : sourceTeam.captain && sourceTeam.captain.openid;
  if (captainOpenid !== outOpenid) return { error: '该队长不在此队伍' };
  const outRegistration = registrations.find((registration) => registration.openid === outOpenid && registration.role === 'captain');
  const inRegistration = registrations.find((registration) => registration.openid === inOpenid && registration.role === 'waitlist');
  if (!outRegistration) return { error: '换下队长资料已失效' };
  if (!inRegistration) return { error: '换入用户不在替补池' };

  const originalCaptain = typeof sourceTeam.captain === 'object' ? sourceTeam.captain : outRegistration;
  const incoming = replacementMember || {};
  const nextCaptain = Object.assign({}, incoming, {
    openid: inRegistration.openid,
    nickname: inRegistration.nickname,
    mmr: inRegistration.mmr,
    roles: inRegistration.roles || [],
    signature: inRegistration.signature || '',
    cardStyle: incoming.cardStyle || inRegistration.cardStyle,
    teamName: originalCaptain.teamName || '',
    teamIcon: originalCaptain.teamIcon || '',
  });
  const nextTeam = Object.assign({}, sourceTeam, {
    captain: nextCaptain,
    players: (sourceTeam.players || []).slice(),
  });
  outRegistration.role = 'waitlist';
  inRegistration.role = 'captain';
  inRegistration.teamName = nextCaptain.teamName;
  inRegistration.teamIcon = nextCaptain.teamIcon;
  outRegistration.teamName = '';
  outRegistration.teamIcon = '';
  return {
    team: nextTeam,
    registrations,
    outNickname: outRegistration.nickname,
    inNickname: inRegistration.nickname,
    captainOpenid: nextCaptain.openid,
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

module.exports = { buildRegistration, replaceBattleCaptain, syncRegistrationProfiles, skipRegistrationSecret };
