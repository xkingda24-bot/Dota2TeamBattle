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

/* 报名阶段名单调整（纯函数，供 moveRegistration action 与测试共用）：
   - 队员 <-> 替补 双向移动，受各自名额限制
   - 队长选人模式：队长可卸任为队员/替补（允许该队暂时缺队长）；队员/替补可升任队长，受 N 个队长名额限制
   返回 { registrations } 或 { error }。 */
function moveRegistrationRole(tournament, openid, toRole) {
  const t = tournament || {};
  if (t.status !== 'registration') return { error: '只有报名阶段可以调整名单' };
  const role = ['player', 'waitlist', 'captain'].indexOf(toRole) >= 0 ? toRole : 'waitlist';
  const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
  const idx = registrations.findIndex((r) => r.openid === openid);
  if (idx < 0) return { error: '未找到该报名' };
  const cur = registrations[idx];
  if (['player', 'waitlist', 'captain'].indexOf(cur.role) < 0) return { error: '只能调整队长/队员/替补' };
  // 队长相关转换只在队长选人模式开放；系统分组模式的队长由分组结果决定
  if (t.mode !== 'captain' && (cur.role === 'captain' || role === 'captain')) {
    return { error: '只有队长选人模式的比赛可以调整队长' };
  }
  if (cur.role === role) return { error: '该用户已在目标名单中' };
  if (role === 'player') {
    const players = registrations.filter((r) => r.role === 'player').length;
    if (players >= t.N * t.K) return { error: '队员名额已满，无法移入' };
  } else if (role === 'waitlist') {
    const waitLimit = t.waitLimit || 0;
    if (waitLimit <= 0) return { error: '本场比赛未设置替补' };
    const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
    if (waitlist >= waitLimit) return { error: '替补名额已满' };
  } else {
    const captains = registrations.filter((r) => r.role === 'captain').length;
    if (captains >= t.N) return { error: '队长名额已满，请先让一名队长卸任为队员或替补' };
  }
  // 队长卸任时保留 teamName/teamIcon：队员身份不展示，重新升任队长时可沿用
  registrations[idx] = Object.assign({}, cur, { role });
  return { registrations };
}

module.exports = { buildRegistration, replaceBattleCaptain, syncRegistrationProfiles, skipRegistrationSecret, moveRegistrationRole };
