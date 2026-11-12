/**
 * 选手生涯统计（纯函数，不访问数据库）。
 *
 * 输入：该玩家参与过的赛事文档数组 + openid；输出：生涯档案页直接可用的结构。
 *
 * 口径说明（与结算页保持一致，不另造一套推断）：
 *   - 胜负按「场」计：matches 里每场已完成的 BO 记一场，取 winner 判定
 *   - 名次直接复用 calculateStandings，未产生冠军的赛事不计名次
 *   - 赛事里的队伍标识是落位号 T{n}，需要用 seeding 反查自己的队伍（teamSlotOf）
 *   - 连胜按赛事时间正序跨赛事累计，bestStreak 为历史最佳
 */

const { resolveBracket } = require('./bracket-resolve');
const { calculateStandings } = require('./standings');

const MAX_PARTNERS = 5;

function openidOf(member) {
  if (!member) return '';
  if (typeof member === 'string') return member;
  return String(member.openid || '');
}

function memberList(team) {
  if (!team) return [];
  const list = [];
  const captain = team.captain;
  if (captain) {
    list.push(Object.assign({}, typeof captain === 'string' ? { openid: captain } : captain, { isCaptain: true }));
  }
  (Array.isArray(team.players) ? team.players : []).forEach((player) => {
    if (player) list.push(Object.assign({}, typeof player === 'string' ? { openid: player } : player, { isCaptain: false }));
  });
  return list;
}

/* 队伍列表：兼容旧文档只有 captainOrder + draft.picks、没有 teams 的阶段 */
function teamsOf(tournament) {
  const t = tournament || {};
  if (Array.isArray(t.teams) && t.teams.length) return t.teams;
  if (Array.isArray(t.captainOrder) && t.captainOrder.length && t.draft) {
    return t.captainOrder.map((captain, index) => ({
      captain,
      players: ((t.draft && t.draft.picks) || [])[index] || [],
    }));
  }
  return [];
}

function seedingOf(tournament, teamCount) {
  const seeding = tournament && tournament.seeding;
  if (Array.isArray(seeding) && seeding.length === teamCount) return seeding;
  return Array.from({ length: teamCount }, (_, index) => index);
}

/**
 * 队伍在赛程里的标识：生成对阵时按落位顺序重排，第 i 支队伍落到 seeding[i] 号位，
 * 对阵文档里记的是 'T' + 落位号，所以要用 seeding.indexOf(队伍下标) 反查。
 */
function teamSlotOf(tournament, teams, teamIndex) {
  const seeding = seedingOf(tournament, teams.length);
  const slot = seeding.indexOf(teamIndex);
  return slot >= 0 ? 'T' + slot : '';
}

function formatOf(tournament) {
  const type = tournament && tournament.bracketType;
  if (type === 'singleRank') return 'singleRank';
  if (type === 'pick8') return 'pick8';
  return type === 'single' ? 'single' : 'double';
}

function buildPlayerStats(tournaments, openidValue, options) {
  const openid = String(openidValue || '');
  const nameByOpenid = (options && options.nameByOpenid) || {};
  const rows = (Array.isArray(tournaments) ? tournaments : [])
    .filter((tournament) => tournament && !tournament.deletedAt)
    .slice()
    .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));

  const placements = [];
  const partnerMap = {};
  let matches = 0;
  let wins = 0;
  let losses = 0;
  let captainTimes = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  let firstAt = 0;
  let lastAt = 0;
  let settledTournaments = 0;

  rows.forEach((tournament) => {
    const teams = teamsOf(tournament);
    const teamIndex = teams.findIndex((team) => memberList(team).some((member) => member.openid === openid));
    if (teamIndex < 0) return; // 只报名没进队伍（替补/取消）不计战绩
    const members = memberList(teams[teamIndex]);
    const captain = members.find((member) => member.isCaptain) || null;
    if (captain && captain.openid === openid) captainTimes += 1;
    const slotTeamId = teamSlotOf(tournament, teams, teamIndex);
    if (!slotTeamId) return;

    const resolved = resolveBracket(tournament);
    let myWins = 0;
    let myLosses = 0;
    resolved.forEach((match) => {
      if (!match || match.status !== 'done' || !match.winner) return;
      const a = match.teamAInfo;
      const b = match.teamBInfo;
      if (!a || !b) return;
      if (a.openid !== slotTeamId && b.openid !== slotTeamId) return;
      const won = match.winner === slotTeamId;
      matches += 1;
      if (won) {
        wins += 1;
        myWins += 1;
        currentStreak += 1;
        if (currentStreak > bestStreak) bestStreak = currentStreak;
      } else {
        losses += 1;
        myLosses += 1;
        currentStreak = 0;
      }
      // 搭档战绩按「同一场一起打」累计，比按赛事计更贴近真实配合
      members.forEach((mate) => {
        if (!mate.openid || mate.openid === openid) return;
        const record = partnerMap[mate.openid] ||
          (partnerMap[mate.openid] = {
            openid: mate.openid,
            nickname: nameByOpenid[mate.openid] || String(mate.nickname || ''),
            matches: 0,
            wins: 0,
          });
        record.matches += 1;
        if (won) record.wins += 1;
        if (!record.nickname && mate.nickname) record.nickname = String(mate.nickname);
      });
    });

    const standings = calculateStandings(tournament, resolved, teams);
    if (standings && standings.complete) settledTournaments += 1;
    const placement = standings && Array.isArray(standings.items)
      ? standings.items.find((item) => item && item.teamId === slotTeamId && item.rank != null)
      : null;
    const createdAt = Number(tournament.createdAt) || 0;
    if (createdAt) {
      if (!firstAt || createdAt < firstAt) firstAt = createdAt;
      if (createdAt > lastAt) lastAt = createdAt;
    }
    if (placement) {
      placements.push({
        id: String(tournament._id || ''),
        name: String(tournament.name || '未命名赛事'),
        time: String(tournament.time || ''),
        date: createdAt,
        bracketType: formatOf(tournament),
        teamName: String(placement.teamName || ''),
        teamSize: members.length,
        rank: Number(placement.rank),
        label: String(placement.label || ''),
        matches: myWins + myLosses,
        wins: myWins,
        losses: myLosses,
        isCaptain: !!(captain && captain.openid === openid),
      });
    }
  });

  const partners = Object.keys(partnerMap)
    .map((key) => {
      const record = partnerMap[key];
      return Object.assign({}, record, {
        winRate: record.matches ? Math.round((record.wins / record.matches) * 100) : 0,
      });
    })
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins || a.openid.localeCompare(b.openid))
    .slice(0, MAX_PARTNERS);

  const countRank = (rank) => placements.filter((item) => item.rank === rank).length;

  return {
    openid,
    // 报名过的赛事数（含替补/未成队）与真正上场过的赛事数
    registered: rows.length,
    playedTournaments: placements.length,
    settledTournaments,
    matches,
    wins,
    losses,
    winRate: matches ? Math.round((wins / matches) * 100) : 0,
    championships: countRank(1),
    runnerUps: countRank(2),
    thirds: countRank(3),
    captainTimes,
    bestStreak,
    currentStreak,
    firstAt: firstAt || null,
    lastAt: lastAt || null,
    // 最近赛事在前，方便页面直接渲染
    placements: placements.slice().sort((a, b) => b.date - a.date),
    partners,
  };
}

module.exports = { buildPlayerStats, memberList, teamsOf, teamSlotOf };
