function validateAutoGroups(players, submittedGroups, teamCount, groupSize) {
  const source = Array.isArray(players) ? players : [];
  const groups = Array.isArray(submittedGroups) ? submittedGroups : null;
  const count = Math.max(0, Math.floor(Number(teamCount) || 0));
  const size = Math.max(0, Math.floor(Number(groupSize) || 0));
  if (!groups || groups.length !== count) return { error: '分组数据不正确（组数不符）' };
  if (source.length !== count * size) return { error: '报名队员数量与分组名额不符' };

  const playerById = {};
  source.forEach((player) => {
    if (player && typeof player.openid === 'string' && player.openid) playerById[player.openid] = player;
  });
  const seen = new Set();
  const result = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (!Array.isArray(group) || group.length !== size || !size) {
      return { error: '第 ' + (groupIndex + 1) + ' 组人数不正确（需恰好 ' + size + ' 人）' };
    }
    const members = [];
    for (const openid of group) {
      if (typeof openid !== 'string' || !playerById[openid] || seen.has(openid)) {
        return { error: '分组数据不正确（重复或非报名队员）' };
      }
      seen.add(openid);
      members.push(playerById[openid]);
    }
    // 组长为组内天梯分最高者；稳定排序保留同分队员的现有顺序。
    members.sort((a, b) => (Number(b.mmr) || 0) - (Number(a.mmr) || 0));
    result.push(members);
  }
  if (seen.size !== source.length) return { error: '还有队员未分组' };
  return { groups: result };
}

function replaceAutoGroupMember(team, sourceRegistrations, outOpenid, inOpenid, replacementMember) {
  const registrations = (Array.isArray(sourceRegistrations) ? sourceRegistrations : [])
    .map((registration) => Object.assign({}, registration));
  const outRegistration = registrations.find((registration) => registration.openid === outOpenid && registration.role === 'player');
  const inRegistration = registrations.find((registration) => registration.openid === inOpenid && registration.role === 'waitlist');
  if (!outRegistration) return { error: '换下队员资料已失效' };
  if (!inRegistration) return { error: '换入用户不在替补池' };

  const sourceTeam = team || {};
  const originalCaptain = sourceTeam.captain;
  const memberOpenid = (member) => typeof member === 'string' ? member : member && member.openid;
  const members = [originalCaptain].concat(sourceTeam.players || []).map((member) => {
    if (member && typeof member === 'object') return Object.assign({}, member);
    return registrations.find((registration) => registration.openid === member) || { openid: member };
  });
  const outIndex = members.findIndex((member) => memberOpenid(member) === outOpenid);
  if (outIndex < 0) return { error: '该队员不在此队伍' };

  const outNickname = outRegistration.nickname;
  members.splice(outIndex, 1, Object.assign({}, replacementMember, {
    openid: inRegistration.openid,
    nickname: inRegistration.nickname,
    mmr: inRegistration.mmr,
    roles: inRegistration.roles || [],
    signature: inRegistration.signature || '',
  }));
  // 稳定排序保留同分队员的原顺序；系统组长始终是队内天梯分最高者。
  members.sort((a, b) => (Number(b.mmr) || 0) - (Number(a.mmr) || 0));
  const nextCaptain = members[0];
  const nextTeam = Object.assign({}, sourceTeam, {
    captain: Object.assign({}, nextCaptain, {
      teamName: (originalCaptain && originalCaptain.teamName) || '',
      teamIcon: (originalCaptain && originalCaptain.teamIcon) || '',
    }),
    players: members.slice(1),
  });
  outRegistration.role = 'waitlist';
  inRegistration.role = 'player';
  return {
    team: nextTeam,
    registrations,
    outNickname,
    inNickname: inRegistration.nickname,
    captainOpenid: nextCaptain.openid,
  };
}

module.exports = { validateAutoGroups, replaceAutoGroupMember };
