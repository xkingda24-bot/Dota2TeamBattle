function buildRegistration(tournament, openid, member, requestedRole, secret, dotaFields, now) {
  if (!tournament || tournament.status !== 'registration') return { error: '当前不在报名阶段' };
  if (String(secret || '') !== String(tournament.secret || '')) return { error: '报名暗号错误' };

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
    if (tournament.mode === 'auto') return { error: '本场比赛为系统分组模式，请报名队员或替补' };
    role = 'captain';
    if (captains.length >= tournament.N) return { error: '队长名额已满' };
  } else if (requestedRole === 'waitlist') {
    role = 'waitlist';
    if (waitLimit <= 0) return { error: '本场比赛未设置替补' };
    if (waitlist.length >= waitLimit) return { error: '替补名额已满' };
  } else if (players.length >= tournament.N * tournament.K) {
    if (waitLimit <= 0) return { error: '队员名额已满' };
    if (waitlist.length >= waitLimit) return { error: '队员名额已满，替补也已满' };
    role = 'waitlist';
    auto = true;
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

module.exports = { buildRegistration };
