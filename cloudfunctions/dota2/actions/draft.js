/**
 * 选人阶段动作。从原 index.js 拆出（纯搬移）。
 */
const { db, _ } = require('../db');
const { ok, fail, getOpenId, shuffle, updateTournamentDoc } = require('../utils');
const { registrationDotaFields } = require('../cards');
const { canManageTournament } = require('../permissions');
const { getTournamentById, requireTournamentManager } = require('../tournaments');
const { mutateTournament } = require('../tournament-transaction');
const { replaceAutoGroupMember } = require('../grouping');
const { replaceBattleCaptain } = require('../registration');
const { sortCaptainsByMmr } = require('../draft-order');

module.exports = {
  /* 开始选人（比赛创建者或最高管理员）：天梯分低的队长先选，初始化蛇形轮次 */
  async startDraft(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '当前不在报名阶段' };
      const registrations = Array.isArray(t.registrations) ? t.registrations : [];
      const captains = registrations.filter((r) => r.role === 'captain');
      const players = registrations.filter((r) => r.role === 'player');
      if (captains.length < t.N) return { error: '队长尚未报满（' + captains.length + '/' + t.N + '）' };
      if (players.length < t.N * t.K) return { error: '队员尚未报满（' + players.length + '/' + t.N * t.K + '）' };
      const captainOrder = sortCaptainsByMmr(captains).map((c) => ({
        openid: c.openid,
        nickname: c.nickname,
        teamName: c.teamName || '',
        teamIcon: c.teamIcon || '',
        mmr: c.mmr || null,
        ...registrationDotaFields(c),
        roles: c.roles || [],
        signature: c.signature || '',
      }));
      return {
        data: {
          status: 'draft',
          captainOrder,
          draft: _.set({ turn: 0, picks: captainOrder.map(() => []) }),
        },
        result: true,
      };
    });
    return result.error ? fail(result.error) : ok(true);
  },

  /* 队长选人 / 比赛创建者或最高管理员代选 */
  async pickPlayer(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const canManage = await canManageTournament(t, openid);
    if (t.status !== 'draft') return fail('当前不在选人阶段');
    const playerOpenid = event.playerOpenid;
    if (!playerOpenid) return fail('缺少被选队员');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const target = players.find((r) => r.openid === playerOpenid);
    if (!target) return fail('该用户不是本次比赛队员');
    const picks = (t.draft.picks || []).slice();
    for (const arr of picks) {
      if (arr.indexOf(playerOpenid) >= 0) return fail('该队员已被选择');
    }
    const turn = t.draft.turn || 0;
    const totalPicks = t.N * t.K;
    if (turn >= totalPicks) return fail('选人已经完成');
    const round = Math.floor(turn / t.N) + 1;
    const inRoundIdx = turn % t.N;
    const capIdx = round % 2 === 1 ? inRoundIdx : t.N - 1 - inRoundIdx;
    const currentCaptain = (t.captainOrder || [])[capIdx];
    if (!currentCaptain) return fail('队长信息缺失，请刷新');
    if (openid !== currentCaptain.openid && !canManage) {
      return fail('还没轮到你选人（当前是' + currentCaptain.nickname + '）');
    }
    const nextPicks = picks.slice();
    nextPicks[capIdx] = (nextPicks[capIdx] || []).concat([playerOpenid]);
    // 乐观并发：只允许在 turn 仍等于当前值时更新
    const upd = await db
      .collection('tournaments')
      .where({ _id: t._id, 'draft.turn': turn })
      .update({
        data: {
          'draft.turn': turn + 1,
          ['draft.picks.' + capIdx]: nextPicks[capIdx],
          updatedAt: Date.now(),
        },
      });
    if (!upd.stats || upd.stats.updated !== 1) {
      return fail('选人顺序有冲突，请刷新后再试');
    }
    const done = turn + 1 >= totalPicks;
    return ok({ picked: playerOpenid, teamIndex: capIdx, done });
  },

  /* 重置选人（比赛创建者或最高管理员）：按天梯分重新排序并清空已选 */
  async resetDraft(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在选人阶段');
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const captainOrder = sortCaptainsByMmr(captains).map((c) => ({
      openid: c.openid,
      nickname: c.nickname,
      teamName: c.teamName || '',
      teamIcon: c.teamIcon || '',
      mmr: c.mmr || null,
      ...registrationDotaFields(c),
      roles: c.roles || [],
      signature: c.signature || '',
    }));
    await updateTournamentDoc(t._id, {
      data: {
        captainOrder,
        draft: _.set({ turn: 0, picks: captainOrder.map(() => []) }),
      },
    });
    return ok(true);
  },

  /* 调整胜者组第一轮对阵（比赛创建者或最高管理员） */
  async setSeeding(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    if (t.mode !== 'auto') {
      const totalPicks = t.N * t.K;
      if (!t.draft || (t.draft.turn || 0) < totalPicks) return fail('选人还未完成');
    }
    const seeding = event.seeding;
    if (!Array.isArray(seeding) || seeding.length !== t.N) return fail('对阵落位数据不正确');
    const seen = {};
    for (const v of seeding) {
      if (typeof v !== 'number' || v < 0 || v >= t.N || seen[v]) return fail('对阵落位数据不正确');
      seen[v] = true;
    }
    await updateTournamentDoc(t._id, { data: { seeding } });
    return ok(true);
  },

  /* 随机对阵 */
  async shuffleSeeding(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    const base = [];
    for (let i = 0; i < t.N; i++) base.push(i);
    await updateTournamentDoc(t._id, { data: { seeding: shuffle(base) } });
    return ok(true);
  },

  /* 比赛创建者或管理员在选人或对战阶段替换队员。 */
  async replacePlayer(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    const teamIndex = Number(event.teamIndex);
    const outOpenid = String(event.outOpenid || '').trim();
    const inOpenid = String(event.inOpenid || '').trim();
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || !outOpenid || !inOpenid || outOpenid === inOpenid) {
      return fail('替换队员参数无效');
    }
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'draft' && t.status !== 'battle') return { error: '仅选人/分组或对战阶段可以替换队员' };
      if ((t.matches || []).some((match) => match.status === 'done')) return { error: '已有比赛记录比分，不能再替换队员' };

      const captainDraft = t.status === 'draft' && t.mode !== 'auto';
      if (captainDraft) {
        const picks = (t.draft && Array.isArray(t.draft.picks) ? t.draft.picks : []).map((team) => Array.isArray(team) ? team.slice() : []);
        if (teamIndex >= picks.length) return { error: '队伍索引无效' };
        const outIndex = picks[teamIndex].indexOf(outOpenid);
        if (outIndex < 0) return { error: '该队员不在此队伍' };
        if (picks.some((team) => team.indexOf(inOpenid) >= 0)) return { error: '该队员已被其他队伍选中' };
        const registrations = t.registrations || [];
        if (!registrations.some((registration) => registration.openid === inOpenid && registration.role === 'player')) {
          return { error: '换入队员不在未选队员池' };
        }
        picks[teamIndex][outIndex] = inOpenid;
        return {
          data: { draft: Object.assign({}, t.draft, { picks }) },
          result: { outOpenid, inOpenid },
        };
      }

      const teams = (t.teams || []).map((team) => Object.assign({}, team, { players: (team.players || []).slice() }));
      if (teamIndex >= teams.length) return { error: '队伍索引无效' };
      const team = teams[teamIndex];
      const captain = team.captain;
      const captainOpenid = typeof captain === 'string' ? captain : captain && captain.openid;
      const memberOpenid = (member) => typeof member === 'string' ? member : member && member.openid;
      const registrations = (t.registrations || []).map((registration) => Object.assign({}, registration));
      const outRegistration = registrations.find((registration) => registration.openid === outOpenid && (
        registration.role === 'player' || (t.status === 'battle' && t.mode !== 'auto' && registration.role === 'captain')
      ));
      const inRegistration = registrations.find((registration) => registration.openid === inOpenid && registration.role === 'waitlist');
      if (!outRegistration) return { error: '换下队员资料已失效' };
      if (!inRegistration) return { error: '换入用户不在替补池' };

      if (t.mode === 'auto') {
        const replaced = replaceAutoGroupMember(team, registrations, outOpenid, inOpenid, {
          openid: inRegistration.openid,
          nickname: inRegistration.nickname,
          mmr: inRegistration.mmr,
          ...registrationDotaFields(inRegistration),
          roles: inRegistration.roles || [],
          signature: inRegistration.signature || '',
          cardStyle: inRegistration.cardStyle,
        });
        if (replaced.error) return { error: replaced.error };
        teams[teamIndex] = replaced.team;
        return {
          data: { teams, registrations: replaced.registrations },
          result: { outOpenid, inOpenid, outNickname: replaced.outNickname, inNickname: replaced.inNickname, captainOpenid: replaced.captainOpenid },
        };
      }

      if (captainOpenid === outOpenid) {
        const replaced = replaceBattleCaptain(team, registrations, outOpenid, inOpenid, {
          openid: inRegistration.openid,
          nickname: inRegistration.nickname,
          mmr: inRegistration.mmr,
          ...registrationDotaFields(inRegistration),
          roles: inRegistration.roles || [],
          signature: inRegistration.signature || '',
          cardStyle: inRegistration.cardStyle,
        });
        if (replaced.error) return { error: replaced.error };
        teams[teamIndex] = replaced.team;
        return {
          data: { teams, registrations: replaced.registrations },
          result: { outOpenid, inOpenid, outNickname: replaced.outNickname, inNickname: replaced.inNickname, captainOpenid: replaced.captainOpenid },
        };
      }
      const outIndex = team.players.findIndex((member) => memberOpenid(member) === outOpenid);
      if (outIndex < 0) return { error: '该队员不在此队伍' };

      const outNickname = outRegistration.nickname;
      team.players.splice(outIndex, 1, {
        openid: inRegistration.openid,
        nickname: inRegistration.nickname,
        mmr: inRegistration.mmr,
        ...registrationDotaFields(inRegistration),
        roles: inRegistration.roles || [],
        signature: inRegistration.signature || '',
        cardStyle: inRegistration.cardStyle,
      });
      outRegistration.role = 'waitlist';
      inRegistration.role = 'player';
      return {
        data: { teams, registrations },
        result: { outOpenid, inOpenid, outNickname, inNickname: inRegistration.nickname },
      };
    });
    return result.error ? fail(result.error) : ok(result.result);
  },
};
