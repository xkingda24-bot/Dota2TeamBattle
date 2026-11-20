/**
 * 对战阶段动作：生成对阵 / 赛制 / 比分 / 修正 / 回退 / 名次。从原 index.js 拆出（纯搬移）。
 */
const { _ } = require('../db');
const { ok, fail, updateTournamentDoc } = require('../utils');
const { BO_LIST, BRACKET_TYPES } = require('../constants');
const {
  requireTournamentManager,
  resolveBracket,
  normalizeBracketType,
} = require('../tournaments');
const { calculateStandings } = require('../standings');
const { syncCaptainDraftFromTeams } = require('../roster-operations');
const {
  buildBracket,
  buildSingleElimination,
  buildSingleRankBracket,
  buildPick8Bracket,
  resolveSeeding,
} = require('../bracket');

module.exports = {
  /* 生成对阵、进入对战阶段（比赛创建者或管理员；赛制在生成时一次选定，之后不可切换） */
  async startBracket(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    // 缺省按双败，保证未升级的小程序端不传参数时行为不变
    const requestedType = event && event.bracketType;
    if (requestedType && BRACKET_TYPES.indexOf(requestedType) < 0) {
      return fail('赛制参数无效');
    }
    const bracketType = normalizeBracketType(requestedType);
    let teams;
    if (t.mode === 'auto') {
      // 系统分组：队伍已在分组确认时写入，无选人环节
      teams = t.teams || [];
      if (!teams.length) return fail('队伍尚未生成（请先完成系统分组）');
    } else {
      const totalPicks = t.N * t.K;
      if (!t.draft || (t.draft.turn || 0) < totalPicks) return fail('选人还未完成');
      const captainOrder = t.captainOrder || [];
      const picks = t.draft.picks || [];
      const playerRegMap = {};
      (t.registrations || [])
        .filter((r) => r.role === 'player')
        .forEach((r) => (playerRegMap[r.openid] = r));
      teams = captainOrder.map((cap, i) => ({
        captain: cap,
        players: (picks[i] || []).map((p) => playerRegMap[p] || { openid: p, nickname: '队员' }),
      }));
    }
    // 落位顺序：合法则按落位表（管理员调整过或点过「随机排位」），
    // 否则退回队伍原始顺序 —— 系统分组按组号 1..N，所以首轮就是「第1组打第2组」「第3组打第4组」……
    const seeding = resolveSeeding(teams.length, t.seeding);
    const ordered = seeding.map((idx) => teams[idx]);
    const bracketTeams = ordered.map((team, i) => ({
      openid: 'T' + i,
      name: (team.captain.teamName || '').trim() ? team.captain.teamName : team.captain.nickname + '战队',
      teamIcon: team.captain.teamIcon || '',
      captainOpenid: team.captain.openid,
    }));
    let matches;
    if (bracketType === 'pick8' && teams.length !== 8) {
      return fail('CBF交叉突围赛需要正好 8 支队伍');
    }
    try {
      matches = bracketType === 'single'
        ? buildSingleElimination(bracketTeams)
        : bracketType === 'singleRank'
          ? buildSingleRankBracket(bracketTeams)
          : bracketType === 'pick8'
            ? buildPick8Bracket(bracketTeams)
            : buildBracket(bracketTeams);
    } catch (e) {
      return fail('生成对阵失败：' + e.message);
    }
    await updateTournamentDoc(t._id, {
      data: {
        status: 'battle',
        bracketType,
        teams,
        seeding,
        matches,
        champion: null,
      },
    });
    return ok(true);
  },

  /* 配置比赛赛制（比赛创建者或最高管理员） */
  async setMatchBo(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const bo = BO_LIST.indexOf(event.bo) >= 0 ? event.bo : null;
    if (!bo) return fail('赛制只能是 BO1 / BO3 / BO5');
    const idx = (t.matches || []).findIndex((m) => m.id === Number(event.matchId));
    if (idx < 0) return fail('比赛不存在');
    if (t.matches[idx].status === 'done') return fail('比赛已结束，不能修改赛制');
    const matches = (t.matches || []).slice();
    matches[idx] = Object.assign({}, matches[idx], { bo });
    await updateTournamentDoc(t._id, { data: { matches } });
    return ok(true);
  },

  /* 记录比赛结果（比赛创建者或最高管理员） */
  async setMatchResult(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const matchId = Number(event.matchId);
    const idx = (t.matches || []).findIndex((m) => m.id === matchId);
    if (idx < 0) return fail('比赛不存在');
    const m = t.matches[idx];
    if (m.status === 'done') return fail('该场已有结果，请先修正再重记');

    // 解析本场实际对阵
    const resolved = resolveBracket(t);
    const rm = resolved[idx];
    if (!rm.teamAInfo || !rm.teamBInfo) return fail('本场对阵尚未完整（有待定队伍）');
    const winner = event.winner;
    if (winner !== rm.teamAInfo.openid && winner !== rm.teamBInfo.openid) {
      return fail('胜方必须是本场比赛的两支队伍之一');
    }
    const winnerIsA = winner === rm.teamAInfo.openid;
    let scoreA = event.scoreA == null ? null : Number(event.scoreA);
    let scoreB = event.scoreB == null ? null : Number(event.scoreB);
    if (m.bo === 'BO1') {
      scoreA = winnerIsA ? 1 : 0;
      scoreB = winnerIsA ? 0 : 1;
    } else {
      const winScore = m.bo === 'BO3' ? 2 : 3;
      if (scoreA == null || scoreB == null) {
        scoreA = winnerIsA ? winScore : 0;
        scoreB = winnerIsA ? 0 : winScore;
      } else {
        if (scoreA < 0 || scoreB < 0 || scoreA > winScore || scoreB > winScore) {
          return fail('比分不合法（BO' + (m.bo === 'BO3' ? '3' : '5') + ' 单方最高 ' + winScore + '）');
        }
        if (scoreA === scoreB) return fail('比分不能打平');
        if ((scoreA > scoreB) !== winnerIsA) return fail('比分与胜方不一致');
      }
    }

    const matches = (t.matches || []).slice();
    const idx2 = matches.findIndex((x) => x.id === matchId);
    matches[idx2] = Object.assign({}, matches[idx2], { status: 'done', winner, scoreA, scoreB });

    const winTeam = winnerIsA ? rm.teamAInfo : rm.teamBInfo;

    let champion = null;
    let status = t.status;
    if (m.isChampionMatch) champion = winTeam;
    // 全部比赛打完才算结束：单败排位赛的总决赛之后还有名次赛
    if ((champion || t.champion) && matches.every((x) => x.status === 'done')) status = 'finished';

    // 用 _.set 整体替换 champion 字段：TCB 的 update 会把嵌套对象展开成点路径（champion.name）
    // 而库里 champion 字段可能是 null（此前非冠军赛写入过 null），点路径更新会报
    // "Cannot create field 'name' in element {champion: null}"
    await updateTournamentDoc(t._id, {
      data: {
        matches,
        // 记录名次赛时不覆盖已经产生的冠军
        champion: _.set(champion || t.champion || null),
        status,
        // 决赛打完标记已结束，但**不自动归档**：由创建者或最高管理员手动归档
        archivedAt: t.archivedAt || null,
      },
    });
    return ok({ champion: champion ? champion.name : null, finished: status === 'finished' });
  },

  /* 修正比赛结果（比赛创建者或最高管理员） */
  async resetMatchResult(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    const matchId = Number(event.matchId);
    const idx = (t.matches || []).findIndex((m) => m.id === matchId);
    if (idx < 0) return fail('比赛不存在');
    const m = t.matches[idx];
    if (m.status !== 'done') return fail('该场比赛还没有结果');

    const matches = (t.matches || []).map((x) => Object.assign({}, x));
    const resetIds = new Set();
    const queue = [matchId];
    while (queue.length) {
      const id = queue.shift();
      if (resetIds.has(id)) continue;
      resetIds.add(id);
      const cur = matches.find((x) => x.id === id);
      if (cur && cur.status === 'done') {
        if (cur.next) queue.push(cur.next.matchId);
        if (cur.loserNext) queue.push(cur.loserNext.matchId);
      }
    }
    for (const id of resetIds) {
      const i = matches.findIndex((x) => x.id === id);
      if (i >= 0) {
        matches[i] = Object.assign({}, matches[i], {
          status: 'pending',
          winner: null,
          scoreA: null,
          scoreB: null,
        });
      }
    }
    const champion = t.champion;
    let status = t.status;
    const championReset = Array.from(resetIds).some((id) => (matches.find((x) => x.id === id) || {}).isChampionMatch);
    if (normalizeBracketType(t.bracketType) === 'singleRank' || normalizeBracketType(t.bracketType) === 'pick8') {
      // 单败排位赛 / 8 队挑选赛：修正任意一场（含名次赛、三四名决赛）都要回到对战阶段，
      // 等全部比赛重打完再结束；冠军只有修正总决赛时才需要清空。
      if (resetIds.size) status = 'battle';
    } else if (champion && championReset) {
      status = 'battle';
    }
    await updateTournamentDoc(t._id, {
      data: {
        matches,
        // 只有修正总决赛才清空冠军；单败排位赛修正名次赛时冠军仍然有效
        champion: _.set(championReset ? null : (champion || null)),
        status,
        // 名次是依据整套赛果计算的；任意一场重置后都必须丢弃旧的人工排序。
        standingsOrder: [],
        archivedAt: status === 'battle' ? null : t.archivedAt || null,
      },
    });
    return ok(true);
  },

  /* 比赛创建者或管理员退回比赛阶段；只清除当前阶段之后的数据。 */
  async rollbackStage(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.archivedAt || t.status === 'finished') return fail('已结束或归档的比赛不能调整阶段');
    if (t.status === 'registration') return fail('当前已经在报名阶段');
    const target = event.stage === 'draft' || event.stage === 'registration' ? event.stage : '';
    if (!target) return fail('目标阶段无效');
    if (t.status === 'draft' && target !== 'registration') return fail('选人/分组阶段只能退回报名阶段');
    if (t.status !== 'draft' && t.status !== 'battle') return fail('当前状态不能调整阶段');

    const data = { status: target, standingsOrder: [], updatedAt: Date.now() };
    if (target === 'registration') {
      Object.assign(data, {
        captainOrder: [],
        draft: null,
        teams: [],
        seeding: null,
        matches: [],
        champion: _.set(null),
        archivedAt: null,
      });
    } else {
      // 对战退回选人时保留草稿进度或系统分组，只清除赛程和落位。
      Object.assign(data, {
        seeding: null,
        matches: [],
        champion: _.set(null),
        archivedAt: null,
      });
      if (t.mode !== 'auto') {
        // 对战中的交换 / 替换以 teams 为准；退回前同步选人草稿，避免旧阵容复活。
        Object.assign(data, syncCaptainDraftFromTeams(t));
        data.teams = _.set(null);
      }
    }
    await updateTournamentDoc(t._id, { data });
    return ok({ status: target });
  },

  /* 比赛创建者或管理员微调结算名次。 */
  async setStandingsOrder(event) {
    const managed = await requireTournamentManager(event, false);
    if (managed.error) return fail(managed.error);
    const t = managed.tournament;
    if (t.status !== 'finished' || !t.champion) return fail('比赛结束后才能调整名次');
    if (t.archivedAt) return fail('已归档比赛不能调整名次');
    if (normalizeBracketType(t.bracketType) === 'pick8') {
      return fail('CBF交叉突围赛的名次由赛果决定，不能手动调整');
    }
    const automatic = calculateStandings(t, resolveBracket(t), t.teams);
    if (!automatic || !automatic.complete) return fail('当前赛果不完整，无法调整名次');
    const requested = Array.isArray(event.order) ? event.order : null;
    if (!requested) return fail('名次列表格式无效');
    let order = [];
    if (requested.length) {
      const valid = new Set(automatic.items.map((item) => item.teamId));
      const seen = new Set();
      for (const value of requested) {
        const teamId = String(value || '');
        if (!valid.has(teamId) || seen.has(teamId)) return fail('名次列表包含无效或重复队伍');
        seen.add(teamId);
        order.push(teamId);
      }
      if (order.length !== valid.size) return fail('名次列表必须包含本场所有队伍');
    }
    await updateTournamentDoc(t._id, { data: { standingsOrder: order, updatedAt: Date.now() } });
    return ok({ standingsOrder: order });
  },
};
