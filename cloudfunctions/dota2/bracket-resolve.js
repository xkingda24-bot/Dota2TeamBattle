/**
 * 对阵解析（纯函数，不访问数据库）。
 *
 * 把每场比赛的「队伍源」解析为实际队伍信息：
 *   { type:'team', openid:'T0', name:'A队' }                 → 直接取该队伍
 *   { type:'match', matchId:3, slot:'winner' | 'loser' }     → 取上游比赛的胜者 / 败者
 *
 * 从 tournaments.js 抽出（纯搬移），供赛事详情与选手生涯统计共用；
 * 本模块可在没有 wx-server-sdk 的环境下直接单测。
 */

function resolveBracket(tournament) {
  const w = {}; // matchId -> {openid, name}
  const l = {};
  const resolveSource = (src) => {
    if (!src) return null;
    if (src.type === 'team') return { openid: src.openid, name: src.name, teamIcon: src.teamIcon || '' };
    const map = src.slot === 'winner' ? w : l;
    return map[src.matchId] || null;
  };
  const ms = ((tournament && tournament.matches) || []).map((m) => {
    const a = resolveSource(m.teamA);
    const b = resolveSource(m.teamB);
    const item = Object.assign({}, m, {
      teamAInfo: a,
      teamBInfo: b,
      displayA: a ? a.name : '待定',
      displayB: b ? b.name : '待定',
    });
    if (m.status === 'done' && m.winner) {
      const winnerIsA = a && a.openid === m.winner;
      w[m.id] = winnerIsA ? a : b;
      l[m.id] = winnerIsA ? b : a;
    }
    return item;
  });
  return ms;
}

module.exports = { resolveBracket };
