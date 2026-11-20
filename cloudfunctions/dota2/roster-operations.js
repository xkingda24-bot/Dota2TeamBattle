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

/** 选人阶段用未选队员或替补替换某队队员；也可用替补换下队长，接任者成为新队长。 */
function replaceCaptainDraftRoster(tournament, input) {
  const t = tournament || {};
  const params = input || {};
  const teamIndex = Number(params.teamIndex);
  const outOpenid = String(params.outOpenid || '').trim();
  const inOpenid = String(params.inOpenid || '').trim();
  const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
  if (teamIndex >= picks.length) return { error: '队伍索引无效' };
  const registrations = (t.registrations || []).map((registration) => Object.assign({}, registration));
  const outRegistration = registrations.find((registration) => registration.openid === outOpenid &&
    (registration.role === 'player' || registration.role === 'captain'));
  const inRegistration = registrations.find((registration) => registration.openid === inOpenid &&
    (registration.role === 'player' || registration.role === 'waitlist'));
  if (!outRegistration) return { error: '换下队员资料已失效' };
  if (!inRegistration) return { error: '换入队员不在未选队员池或替补池' };
  if (picks.some((team) => team.indexOf(inOpenid) >= 0)) return { error: '该队员已被其他队伍选中' };

  const captainOrder = (t.captainOrder || []).map((captain) => Object.assign({}, captain));
  const captain = captainOrder[teamIndex];
  if (captain && String(captain.openid || '') === outOpenid) {
    // 队长只能替换：换下后进入替补席，换入者接任队长并继承队名、队标
    const totalPicks = (Number(t.N) || 0) * (Number(t.K) || 0);
    const turn = (t.draft && t.draft.turn) || 0;
    if (totalPicks && turn < totalPicks) return { error: '选人完成后才能替换队长' };
    // 队长属于队伍核心，只允许用替补席队员替换，避免未被选中的队员直接当队长
    if (inRegistration.role !== 'waitlist') return { error: '队长只能由替补替换，请选择替补席队员' };
    const nextCaptain = Object.assign({}, captain, {
      openid: inRegistration.openid,
      nickname: inRegistration.nickname,
      mmr: inRegistration.mmr,
      roles: inRegistration.roles || [],
      signature: inRegistration.signature || '',
      cardStyle: inRegistration.cardStyle,
      dota2Id: inRegistration.dota2Id || '',
      dota2MmrVerified: inRegistration.dota2MmrVerified,
      dota2RankVerified: inRegistration.dota2RankVerified,
      dota2RankLabel: inRegistration.dota2RankLabel || '',
      dota2RankTier: inRegistration.dota2RankTier,
      dota2LeaderboardRank: inRegistration.dota2LeaderboardRank,
      dota2RankVerifiedAt: inRegistration.dota2RankVerifiedAt || inRegistration.dota2VerifiedAt,
      teamName: captain.teamName || '',
      teamIcon: captain.teamIcon || '',
    });
    captainOrder[teamIndex] = nextCaptain;
    outRegistration.role = 'waitlist';
    outRegistration.teamName = '';
    outRegistration.teamIcon = '';
    inRegistration.role = 'captain';
    inRegistration.teamName = nextCaptain.teamName;
    inRegistration.teamIcon = nextCaptain.teamIcon;
    return {
      data: { captainOrder, registrations },
      result: { outOpenid, inOpenid, incomingRole: 'captain', replacedCaptain: true },
    };
  }

  const outIndex = picks[teamIndex].indexOf(outOpenid);
  if (outIndex < 0) return { error: '该队员不在此队伍' };
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

/**
 * 对战退回选人时，以当前 teams 为权威阵容重建队长选人草稿。
 * 对战阶段的交换、替补替换和队长替换只改 teams；若继续沿用旧 draft.picks，
 * 换下者会重新出现在队伍中，换上者则会同时落入未选队员池。
 */
function syncCaptainDraftFromTeams(tournament) {
  const t = tournament || {};
  if (t.mode === 'auto' || !Array.isArray(t.teams) || !t.teams.length) return {};
  const registrations = Array.isArray(t.registrations) ? t.registrations : [];
  const oldCaptainOrder = Array.isArray(t.captainOrder) ? t.captainOrder : [];
  const captainOrder = t.teams.map((team, index) => {
    const captain = team && team.captain;
    if (captain && typeof captain === 'object') return Object.assign({}, captain);
    const openid = memberOpenid(captain);
    const oldCaptain = oldCaptainOrder[index];
    const registration = registrations.find((item) => item && item.openid === openid);
    return Object.assign({}, oldCaptain && memberOpenid(oldCaptain) === openid ? oldCaptain : {}, registration || {}, { openid });
  });
  const picks = t.teams.map((team) => ((team && team.players) || []).map(memberOpenid).filter(Boolean));
  const oldDraft = t.draft && typeof t.draft === 'object' ? t.draft : {};
  const fallbackTurn = (Number(t.N) || 0) * (Number(t.K) || 0);
  const turn = Number.isInteger(oldDraft.turn) ? oldDraft.turn : fallbackTurn;
  return { captainOrder, draft: Object.assign({}, oldDraft, { turn, picks }) };
}

module.exports = { swapCaptainRoster, replaceCaptainDraftRoster, syncCaptainDraftFromTeams };
