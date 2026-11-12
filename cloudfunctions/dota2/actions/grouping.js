/**
 * 系统分组动作。从原 index.js 拆出（纯搬移）。
 */
const { db } = require('../db');
const { ok, fail, updateTournamentDoc } = require('../utils');
const { registrationDotaFields, normalizeCardStyle } = require('../cards');
const { publicDotaCardFields } = require('../card-profile');
const { syncTournamentRegistrations } = require('../users');
const { requireTournamentManager } = require('../tournaments');
const { runAutoGroup } = require('../auto-group');
const { validateAutoGroups, validateAutoGroupCaptains } = require('../grouping');
const { mutateTournament } = require('../tournament-transaction');
const { syncRegistrationProfiles } = require('../registration');

module.exports = {
  /* 系统分组：预览分组结果（不落库）。每组 K 人；全局前 N 名分别担任组长；均分差尽量 ≤200 */
  async autoGroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const synced = await syncTournamentRegistrations(t);
    const players = synced.registrations.filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    const result = runAutoGroup(players, t.N, t.K);
    const profiles = synced.profiles;
    result.groups = result.groups.map((group) => {
      const members = group.members.map((member) => {
        const profile = profiles[member.openid];
        const cardPlayer = Object.assign({}, member);
        if (profile) {
          ['nickname', 'mmr', 'roles', 'signature'].forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(profile, field)) cardPlayer[field] = profile[field];
          });
        }
        return Object.assign(cardPlayer, publicDotaCardFields(
          cardPlayer.mmr,
          profile || cardPlayer,
          null
        ), {
          rolesText: Array.isArray(cardPlayer.roles) ? cardPlayer.roles.map((role) => role + '号位').join(' / ') : '',
          signature: cardPlayer.signature || '',
          cardStyle: normalizeCardStyle(profile && profile.cardStyle || cardPlayer.cardStyle),
        });
      });
      const captain = members.find((member) => member.openid === (group.captain && group.captain.openid)) || members[0] || null;
      members.forEach((member) => (member.isCaptain = !!captain && member.openid === captain.openid));
      return Object.assign({}, group, { captain, members });
    });
    return ok(result);
  },

  /* 系统分组：确认分组并写入队伍（服务端重算，不信任客户端数据） */
  async confirmGroup(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const current = managed.tournament;
    const latestProfiles = await syncTournamentRegistrations(current);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode !== 'auto') return { error: '本场比赛不是系统分组模式' };
      if (t.status !== 'registration') return { error: '当前不在报名阶段' };
      const synced = syncRegistrationProfiles(t.registrations, latestProfiles.profiles);
      const registrations = synced.registrations;
      const players = registrations.filter((r) => r.role === 'player');
      const need = t.N * t.K;
      if (players.length < need) return { error: '队员尚未报满（' + players.length + '/' + need + '），报满后才能分组' };
      const playerById = {};
      players.forEach((p) => (playerById[p.openid] = p));
      let groups;
      if (Array.isArray(event.groups)) {
        if (event.groups.length !== t.N) return { error: '分组数据不正确（组数不符）' };
        const seen = {};
        let total = 0;
        groups = event.groups.map((arr, gi) => {
          if (!Array.isArray(arr) || arr.length !== t.K || arr.length < 1) return { error: '第 ' + (gi + 1) + ' 组人数不正确（需恰好 ' + t.K + ' 人）' };
          return arr.map((oid) => {
            if (typeof oid !== 'string' || seen[oid] || !playerById[oid]) return { error: '分组数据不正确（重复或非报名队员）' };
            seen[oid] = true;
            total++;
            return playerById[oid];
          });
        });
        const invalid = groups.find((group) => group && group.error) ||
          groups.reduce((found, group) => found || (Array.isArray(group) && group.find((member) => member && member.error)), null);
        if (invalid) return invalid;
        if (total !== players.length) return { error: '还有队员未分组' };
        const captainCheck = validateAutoGroupCaptains(players, groups, t.N);
        if (captainCheck.error) return captainCheck;
        groups = groups.map((members) => members.slice().sort((a, b) => (b.mmr || 0) - (a.mmr || 0)));
      } else {
        groups = runAutoGroup(players, t.N, t.K).groups.map((g) => g.members);
      }
      const teams = groups.map((members) => {
        const captain = members[0];
        return {
          captain: {
            openid: captain.openid,
            nickname: captain.nickname,
            teamName: '',
            teamIcon: '',
            mmr: captain.mmr,
            ...registrationDotaFields(captain),
            roles: captain.roles || [],
            signature: captain.signature || '',
          },
          players: members.slice(1).map((m) => ({
            openid: m.openid,
            nickname: m.nickname,
            mmr: m.mmr,
            ...registrationDotaFields(m),
            roles: m.roles || [],
            signature: m.signature || '',
          })),
        };
      });
      return { data: { status: 'draft', registrations, teams, captainOrder: [], draft: null, seeding: null }, result: {} };
    });
    return result.error ? fail(result.error) : ok({});
  },

  /* 系统分组：在分组阶段保存比赛创建者或最高管理员调整后的队员名单。 */
  async saveAutoGroups(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto' || t.status !== 'draft') return fail('当前不在系统分组阶段');
    if ((t.matches || []).length) return fail('对阵已生成，不能再调整分组');
    const players = (t.registrations || []).filter((registration) => registration.role === 'player');
    const checked = validateAutoGroups(players, event.groups, t.N, t.K);
    if (checked.error) return fail(checked.error);

    const oldTeams = t.teams || [];
    const teams = checked.groups.map((members, index) => {
      const oldCaptain = oldTeams[index] && oldTeams[index].captain || {};
      const captain = members[0];
      return {
        captain: {
          openid: captain.openid,
          nickname: captain.nickname,
          teamName: oldCaptain.teamName || '',
          teamIcon: oldCaptain.teamIcon || '',
          mmr: captain.mmr,
          ...registrationDotaFields(captain),
          roles: captain.roles || [],
          signature: captain.signature || '',
        },
        players: members.slice(1).map((member) => ({
          openid: member.openid,
          nickname: member.nickname,
          mmr: member.mmr,
          ...registrationDotaFields(member),
          roles: member.roles || [],
          signature: member.signature || '',
        })),
      };
    });
    await updateTournamentDoc(t._id, { data: { teams, updatedAt: Date.now() } });
    return ok(true);
  },

  /* 系统分组：返回报名阶段重新分组（比赛创建者或最高管理员） */
  async resetGroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.mode !== 'auto') return fail('仅系统分组模式支持重新分组');
    if (t.status !== 'draft') return fail('只有分组完成后（未生成对阵前）可以重新分组');
    await updateTournamentDoc(t._id, {
      data: { status: 'registration', teams: [], seeding: null, matches: [], champion: null, updatedAt: Date.now() },
    });
    return ok(true);
  },

  /* 系统分组：一键重新分组（比赛创建者或最高管理员）。
     直接在分组阶段重算并替换当前分组（随机化：组长仍为天梯分前 N，组员入组顺序打乱），
     保留各队已设置的队名/队标；仅分组完成后（未生成对阵前）可调用。 */
  async regroup(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const current = managed.tournament;
    const latestProfiles = await syncTournamentRegistrations(current);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.mode !== 'auto') return { error: '仅系统分组模式支持重新分组' };
      if (t.status !== 'draft') return { error: '只有分组完成后（未生成对阵前）可以重新分组' };
      if ((t.matches || []).length) return { error: '对阵已生成，不能再重新分组' };
      const synced = syncRegistrationProfiles(t.registrations, latestProfiles.profiles);
      const players = synced.registrations.filter((r) => r.role === 'player');
      const need = t.N * t.K;
      if (players.length < need) return { error: '队员尚未报满（' + players.length + '/' + need + '），报满后才能分组' };
      const groups = runAutoGroup(players, t.N, t.K).groups.map((g) => g.members);
      const oldTeams = t.teams || [];
      const teams = groups.map((members, index) => {
        const oldCaptain = oldTeams[index] && oldTeams[index].captain || {};
        const captain = members[0];
        return {
          captain: {
            openid: captain.openid,
            nickname: captain.nickname,
            teamName: oldCaptain.teamName || '',
            teamIcon: oldCaptain.teamIcon || '',
            mmr: captain.mmr,
            ...registrationDotaFields(captain),
            roles: captain.roles || [],
            signature: captain.signature || '',
          },
          players: members.slice(1).map((member) => ({
            openid: member.openid,
            nickname: member.nickname,
            mmr: member.mmr,
            ...registrationDotaFields(member),
            roles: member.roles || [],
            signature: member.signature || '',
          })),
        };
      });
      return { data: { teams }, result: {} };
    });
    return result.error ? fail(result.error) : ok({});
  },
};
