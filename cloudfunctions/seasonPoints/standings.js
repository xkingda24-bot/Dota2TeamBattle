/**
 * 依据已完成赛程计算最终名次，兼容双败（TI）与单败两种赛制。
 *
 * 名次只在总决赛完成后生成：
 *   1. 总决赛胜者
 *   2. 总决赛败者
 *   3. 双败：败者组决赛败者（N >= 3）；单败：半决赛败者共享区间（不设三四名决赛）
 *   4. 之后按淘汰轮次倒序排列；同轮淘汰的队伍共享名次区间。
 *
 * 赛制取自 tournament.bracketType：'single' 表示单败，其余（含历史数据缺失该字段）
 * 一律按双败处理。这个模块不写数据库，每次读取比赛详情时从比赛结果确定性重算。
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getTeamId(info) {
  return info && info.openid ? String(info.openid) : '';
}

function getLoser(match, a, b) {
  if (!match || match.status !== 'done' || !match.winner) return null;
  if (a && match.winner === a.openid) return b || null;
  if (b && match.winner === b.openid) return a || null;
  // 兼容极旧数据：winner 可能已经是字符串，但 teamAInfo/teamBInfo 未解析。
  if (match.teamAInfo && match.winner === match.teamAInfo.openid) return match.teamBInfo || null;
  if (match.teamBInfo && match.winner === match.teamBInfo.openid) return match.teamAInfo || null;
  return null;
}

function getWinner(match, a, b) {
  if (!match || match.status !== 'done' || !match.winner) return null;
  if (a && match.winner === a.openid) return a;
  if (b && match.winner === b.openid) return b;
  if (match.teamAInfo && match.winner === match.teamAInfo.openid) return match.teamAInfo;
  if (match.teamBInfo && match.winner === match.teamBInfo.openid) return match.teamBInfo;
  return null;
}

function stageRank(stage, format) {
  const raw = String(stage || '');
  if (format === 'single') {
    // 单败没有败者组：淘汰轮次越靠后名次越高，UB 编号即轮次序号
    const ub = raw.match(/^UB(\d+)$/i);
    return ub ? Number(ub[1]) : -1;
  }
  if (stage === 'LBF') return 1000000;
  const m = raw.match(/^LB(\d+)$/i);
  return m ? Number(m[1]) : -1;
}

function memberList(team) {
  if (!team) return [];
  const list = [];
  const captain = team.captain;
  if (captain) {
    list.push(Object.assign({}, typeof captain === 'string' ? { openid: captain } : captain, { isCaptain: true }));
  }
  asArray(team.players).forEach((player) => {
    if (player) list.push(Object.assign({}, typeof player === 'string' ? { openid: player } : player, { isCaptain: false }));
  });
  return list;
}

function teamRecord(info, source) {
  const id = getTeamId(info);
  const tm = source || {};
  const members = memberList(tm);
  const captain = members.find((member) => member.isCaptain) || members[0] || null;
  return {
    teamId: id,
    teamName: (info && info.name) || tm.name || '未命名战队',
    teamIcon: (info && info.teamIcon) || tm.teamIcon || (captain && captain.teamIcon) || '',
    captainOpenid: captain && captain.openid ? captain.openid : '',
    members,
  };
}

/**
 * 单败排位赛的名次文案：3、4 名分开（有季军赛），5 名之后同组两队共享名次，标「并列」。
 */
function placementRankLabel(rank) {
  const value = Number(rank);
  if (value === 1) return '冠军';
  if (value === 2) return '亚军';
  if (value === 3) return '季军';
  if (value === 4) return '第4名';
  return '第' + value + '名（并列）';
}

function formatRank(rank, size) {
  if (size > 1) return '第' + rank + '-' + (rank + size - 1) + '名';
  return '第' + rank + '名';
}

function withRank(record, rank, label, match) {
  return Object.assign({}, record, {
    rank,
    label,
    eliminatedAtMatchId: match ? match.id : null,
    eliminationStage: match ? match.stage || '' : '',
  });
}

/**
 * @param {Object} tournament 原始 tournaments 文档或 compose 中的对象
 * @param {Array} resolvedMatches resolveBracket(tournament) 的返回值
 * @param {Array} decoratedTeams 可选，优先使用已注入 cardStyle 的队伍数据
 * @returns {Object|null} { version, complete, generatedAt, items } 或 null
 */
function calculateStandings(tournament, resolvedMatches, decoratedTeams) {
  const t = tournament || {};
  const format = t.bracketType === 'singleRank'
    ? 'singleRank'
    : (t.bracketType === 'single' ? 'single' : 'double');
  const matches = asArray(resolvedMatches || t.matches);
  if (!matches.length) return null;

  const finalMatch = matches.find((match) => match && (match.isChampionMatch || match.stage === 'GF')) || null;
  if (!finalMatch || finalMatch.status !== 'done') return null;

  const teams = asArray(decoratedTeams || t.teams);
  const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N
    ? t.seeding
    : teams.map((_, index) => index);
  const sourceById = {};
  teams.forEach((team, index) => {
    const slot = seeding.indexOf(index);
    if (slot >= 0) sourceById['T' + slot] = team;
  });

  // 从赛程中收集所有队伍，避免旧数据没有 teams 时结算页完全空白。
  const records = {};
  matches.forEach((match) => {
    ['teamAInfo', 'teamBInfo'].forEach((key) => {
      const info = match && match[key];
      const id = getTeamId(info);
      if (id && !records[id]) records[id] = teamRecord(info, sourceById[id]);
    });
  });
  Object.keys(sourceById).forEach((id) => {
    if (!records[id]) records[id] = teamRecord({ openid: id }, sourceById[id]);
  });
  const addRecord = (info) => {
    const id = getTeamId(info);
    if (!id) return null;
    if (!records[id]) records[id] = teamRecord(info, sourceById[id]);
    return records[id];
  };

  addRecord(finalMatch.teamAInfo);
  addRecord(finalMatch.teamBInfo);
  const winnerInfo = getWinner(finalMatch, finalMatch.teamAInfo, finalMatch.teamBInfo);
  const loserInfo = getLoser(finalMatch, finalMatch.teamAInfo, finalMatch.teamBInfo);
  let winner = addRecord(winnerInfo);
  const loser = addRecord(loserInfo);
  // 某些历史文档只保存 champion，不保存决赛两侧的解析信息；冠军仍可展示，
  // 但没有足够信息时不猜测亚军/季军。
  if (!winner && t.champion && t.champion.openid) {
    const champion = addRecord(t.champion);
    if (champion) {
      champion.teamName = t.champion.name || champion.teamName;
      winner = champion;
    }
  }
  if (!winner) return null;

  const items = [];
  const used = {};
  const push = (record, rank, label, match) => {
    if (!record || !record.teamId || used[record.teamId]) return;
    used[record.teamId] = true;
    items.push(withRank(record, rank, label, match));
  };
  push(winner, 1, '冠军', finalMatch);
  push(loser, 2, '亚军', finalMatch);

  // 单败排位赛：名次由名次赛直接决定（赛程里每场名次赛都写明胜者与败者的名次）
  if (format === 'singleRank') {
    matches.forEach((match) => {
      if (!match || !match.isPlacementMatch || !match.placement) return;
      if (match.status !== 'done') return;
      const winRank = Number(match.placement.winRank);
      const loseRank = Number(match.placement.loseRank);
      const winTeam = getWinner(match, match.teamAInfo, match.teamBInfo);
      const loseTeam = getLoser(match, match.teamAInfo, match.teamBInfo);
      push(addRecord(winTeam), winRank, placementRankLabel(winRank), match);
      push(addRecord(loseTeam), loseRank, placementRankLabel(loseRank), match);
    });
    // 名次赛是逐场推入的，按名次重排成榜单顺序（同档并列两队相邻）
    items.sort((a, b) => a.rank - b.rank);
  }

  // LBF 败者为季军（仅双败）。N=2 时没有败者组决赛，不能把总决赛败者重复成季军。
  // 单败与单败排位赛都不靠败者组决赛定季军（前者共享第3-4名，后者有季军赛）。
  const lowerFinal = format === 'double'
    ? matches.find((match) => match && match.stage === 'LBF' && match.status === 'done')
    : null;
  if (lowerFinal) {
    const lowerA = lowerFinal.teamAInfo;
    const lowerB = lowerFinal.teamBInfo;
    push(addRecord(getLoser(lowerFinal, lowerA, lowerB)), 3, '季军', lowerFinal);
  }

  // 其余已淘汰队伍按败者组轮次从后往前排列。一个轮次可能有多场，采用
  // 竞赛排名（例如 4、5、5、7），并把范围写在 label 中，避免伪造精确先后。
  // 单败排位赛已在上面按名次赛定名次，不再走「同轮共享区间」的推断。
  const eliminated = [];
  if (format !== 'singleRank') {
    matches.forEach((match) => {
      if (!match || match.status !== 'done' || match === finalMatch || match === lowerFinal) return;
      if (match.loserNext) return;
      const loserTeam = getLoser(match, match.teamAInfo, match.teamBInfo);
      const record = addRecord(loserTeam);
      if (!record || used[record.teamId]) return;
      eliminated.push({ match, record, stageRank: stageRank(match.stage, format) });
    });
  }
  eliminated.sort((a, b) => b.stageRank - a.stageRank || Number(a.match.id || 0) - Number(b.match.id || 0));
  let rank = lowerFinal ? 4 : 3;
  let cursor = 0;
  while (cursor < eliminated.length) {
    const currentRank = eliminated[cursor].stageRank;
    const group = [];
    while (cursor < eliminated.length && eliminated[cursor].stageRank === currentRank) {
      group.push(eliminated[cursor]);
      cursor++;
    }
    const label = formatRank(rank, group.length);
    group.forEach((entry) => push(entry.record, rank, label, entry.match));
    rank += group.length;
  }

  // 不为缺失赛果的数据虚构名次。旧数据若存在不完整晋级关系，明确显示待核实队伍。
  Object.keys(records).filter((id) => !used[id]).forEach((id) => {
    const record = records[id];
    used[id] = true;
    items.push(Object.assign({}, record, {
      rank: null,
      label: '名次待核实',
      eliminatedAtMatchId: null,
      eliminationStage: '',
    }));
  });

  const rankedCount = items.filter((item) => item.rank != null).length;
  const expectedTeamCount = teams.length || Object.keys(records).length;
  // 双败要求败者组决赛存在才认为赛果完整；单败没有败者组，只要全员有名次即可结算；
  // 单败排位赛还要求名次赛全部打完，否则被淘汰队伍的名次无法确定。
  const requiresLowerFinal = format === 'double' && expectedTeamCount > 2;
  const pendingPlacement = format === 'singleRank'
    ? matches.filter((match) => match && match.isPlacementMatch && match.status !== 'done').length
    : 0;
  const complete = rankedCount === expectedTeamCount && (!requiresLowerFinal || !!lowerFinal) && !pendingPlacement;
  let finalItems = items;
  const requestedOrder = Array.isArray(t.standingsOrder) ? t.standingsOrder : [];
  if (complete && requestedOrder.length === items.length) {
    const byTeamId = {};
    items.forEach((item) => (byTeamId[item.teamId] = item));
    const seenOrder = new Set();
    const validOrder = requestedOrder.every((teamId) => {
      if (!byTeamId[teamId] || seenOrder.has(teamId)) return false;
      seenOrder.add(teamId);
      return true;
    });
    if (validOrder && seenOrder.size === items.length) {
      finalItems = requestedOrder.map((teamId, index) => {
        const rank = index + 1;
        const label = rank === 1 ? '冠军' : rank === 2 ? '亚军' : rank === 3 && expectedTeamCount > 2 ? '季军' : '第' + rank + '名';
        return Object.assign({}, byTeamId[teamId], { rank, label });
      });
    }
  }

  return {
    version: 1,
    complete,
    generatedAt: t.updatedAt || t.archivedAt || null,
    items: finalItems,
  };
}

module.exports = { calculateStandings };
