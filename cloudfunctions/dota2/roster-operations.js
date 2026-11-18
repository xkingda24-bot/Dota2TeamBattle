function memberOpenid(member) {
  return typeof member === 'string' ? member : member && member.openid;
}

/**
 * 队长模式下交换两支队伍的普通队员。队长不换，报名角色不变；已有比分后禁止调整。
 */
function swapCaptainRoster(tournament, input) {
  const t = tournament || {};
  const params = input || {};
  if (t.mode === 'auto') return { error: '系统分组模式请使用分组交换' };
  if (t.status !== 'draft' && t.status !== 'battle') return { error: '仅选人/分组或对战阶段可以交换队员' };
  if ((t.matches || []).some((match) => match.status === 'done')) return { error: '已有比赛记录比分，不能再交换队员' };
  const teamAIndex = Number(params.teamAIndex);
  const teamBIndex = Number(params.teamBIndex);
  const openidA = String(params.openidA || '').trim();
  const openidB = String(params.openidB || '').trim();
  if (!Number.isInteger(teamAIndex) || !Number.isInteger(teamBIndex) || teamAIndex < 0 || teamBIndex < 0 || !openidA || !openidB) {
    return { error: '交换队员参数无效' };
  }
  if (teamAIndex === teamBIndex) return { error: '请选择不同队伍的两名队员进行交换' };
  if (openidA === openidB) return { error: '两名队员不能相同' };

  if (t.status === 'draft') {
    const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
    if (teamAIndex >= picks.length || teamBIndex >= picks.length) return { error: '队伍索引无效' };
    const indexA = picks[teamAIndex].indexOf(openidA);
    const indexB = picks[teamBIndex].indexOf(openidB);
    if (indexA < 0 || indexB < 0) return { error: '交换队员不在对应队伍中，请刷新后重试' };
    [picks[teamAIndex][indexA], picks[teamBIndex][indexB]] = [openidB, openidA];
    return {
      data: { draft: Object.assign({}, t.draft, { picks }) },
      result: { teamAIndex, teamBIndex, openidA, openidB },
    };
  }

  const teams = (t.teams || []).map((team) => Object.assign({}, team, { players: (team.players || []).slice() }));
  if (teamAIndex >= teams.length || teamBIndex >= teams.length) return { error: '队伍索引无效' };
  const indexA = teams[teamAIndex].players.findIndex((member) => memberOpenid(member) === openidA);
  const indexB = teams[teamBIndex].players.findIndex((member) => memberOpenid(member) === openidB);
  if (indexA < 0 || indexB < 0) return { error: '交换队员不在对应队伍中，请刷新后重试' };
  [teams[teamAIndex].players[indexA], teams[teamBIndex].players[indexB]] = [teams[teamBIndex].players[indexB], teams[teamAIndex].players[indexA]];
  return {
    data: { teams },
    result: { teamAIndex, teamBIndex, openidA, openidB },
  };
}

/** 选人阶段用未选队员或替补替换某队队员。 */
function replaceCaptainDraftRoster(tournament, input) {
  const t = tournament || {};
  const params = input || {};
  const teamIndex = Number(params.teamIndex);
  const outOpenid = String(params.outOpenid || '').trim();
  const inOpenid = String(params.inOpenid || '').trim();
  const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
  if (teamIndex >= picks.length) return { error: '队伍索引无效' };
  const outIndex = picks[teamIndex].indexOf(outOpenid);
  if (outIndex < 0) return { error: '该队员不在此队伍' };
  if (picks.some((team) => team.indexOf(inOpenid) >= 0)) return { error: '该队员已被其他队伍选中' };
  const registrations = (t.registrations || []).map((registration) => Object.assign({}, registration));
  const outRegistration = registrations.find((registration) => registration.openid === outOpenid && registration.role === 'player');
  const inRegistration = registrations.find((registration) => registration.openid === inOpenid && (registration.role === 'player' || registration.role === 'waitlist'));
  if (!outRegistration) return { error: '换下队员资料已失效' };
  if (!inRegistration) return { error: '换入队员不在未选队员池或替补池' };
  picks[teamIndex][outIndex] = inOpenid;
  const incomingWasWaitlist = inRegistration.role === 'waitlist';
  if (incomingWasWaitlist) {
    inRegistration.role = 'player';
    outRegistration.role = 'waitlist';
  }
  return {
    data: { draft: Object.assign({}, t.draft, { picks }), registrations },
    result: { outOpenid, inOpenid, incomingRole: incomingWasWaitlist ? 'waitlist' : 'player' },
  };
}

module.exports = { swapCaptainRoster, replaceCaptainDraftRoster };
