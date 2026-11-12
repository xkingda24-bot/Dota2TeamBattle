/**
 * 系统分组算法（纯计算，不落库）。从原 index.js 拆出（纯搬移）。
 *
 * 1) 天梯分最高的 N 人先固定为各组组长；
 * 2) 其余队员优先补入当前平均分较低的队伍，尽量平衡各组平均分；
 * 3) 只交换非组长队员做局部优化，平均分差优先，位置缺位次优；
 * 返回预览结构（含每组名单/均分/缺位和最高/最低平均分差）。
 */
const { shuffle } = require('./utils');
const { registrationDotaFields } = require('./cards');

function runAutoGroup(players, N, K) {
  const has = (p, r) => Array.isArray(p.roles) && p.roles.indexOf(r) >= 0;
  const missingRoles = (g) => {
    const s = new Set();
    g.forEach((p) => (p.roles || []).forEach((r) => s.add(r)));
    const m = [];
    for (let r = 1; r <= 5; r++) if (!s.has(r)) m.push(r);
    return m;
  };
  const mmr = (p) => {
    const value = Number(p && p.mmr);
    return Number.isFinite(value) ? value : 0;
  };
  const avg = (g) => (g.length ? g.reduce((s, p) => s + mmr(p), 0) / g.length : 0);
  const source = (Array.isArray(players) ? players : []).map((p, index) => Object.assign({}, p, { _groupOrder: index }));
  const sorted = source.slice().sort((a, b) => mmr(b) - mmr(a) || a._groupOrder - b._groupOrder);
  const captains = sorted.slice(0, N);
  const pool = shuffle(sorted.slice(N));
  let groups = captains.map((captain) => [captain]);

  // 1. 组长固定后，打乱组员入组顺序（每次分组结果不同，仍以当前预计均分最低的队伍为优先），
  //    不满意可再次分组；组长始终保持为天梯分最高的前 N 名。
  pool.forEach((player) => {
    let pickIndex = -1;
    let pickScore = null;
    groups.forEach((group, index) => {
      if (group.length >= K) return;
      const missing = missingRoles(group);
      const fillsRole = missing.some((role) => has(player, role)) ? 0 : 1;
      const projected = (avg(group) * group.length + mmr(player)) / (group.length + 1);
      const score = { projected, fillsRole, size: group.length, index };
      if (!pickScore || score.projected < pickScore.projected ||
        (score.projected === pickScore.projected && score.fillsRole < pickScore.fillsRole) ||
        (score.projected === pickScore.projected && score.fillsRole === pickScore.fillsRole && score.size < pickScore.size)) {
        pickScore = score;
        pickIndex = index;
      }
    });
    if (pickIndex >= 0) groups[pickIndex].push(player);
  });

  // 2. 局部交换：组长位置固定，只接受能降低平均分极差的交换；同分时减少位置缺位。
  const score = () => {
    const averages = groups.map(avg);
    const maxAvg = averages.length ? Math.max.apply(null, averages) : 0;
    const minAvg = averages.length ? Math.min.apply(null, averages) : 0;
    const maxD = maxAvg - minAvg;
    const missN = groups.reduce((sum, group) => sum + missingRoles(group).length, 0);
    return { maxD, maxAvg, minAvg, missN };
  };
  const better = (a, b) => a.maxD < b.maxD || (a.maxD === b.maxD && a.missN < b.missN);
  let bestS = score();
  let best = groups.map((group) => group.slice());
  for (let pass = 0; pass < 16; pass++) {
    let candidate = null;
    for (let gi = 0; gi < N; gi++) {
      for (let gj = gi + 1; gj < N; gj++) {
        for (let ai = 1; ai < groups[gi].length; ai++) {
          for (let bj = 1; bj < groups[gj].length; bj++) {
            const temp = groups[gi][ai];
            groups[gi][ai] = groups[gj][bj];
            groups[gj][bj] = temp;
            const current = score();
            groups[gj][bj] = groups[gi][ai];
            groups[gi][ai] = temp;
            if (better(current, bestS) && (!candidate || better(current, candidate.score))) {
              candidate = { gi, gj, ai, bj, score: current };
            }
          }
        }
      }
    }
    if (!candidate) break;
    const temp = groups[candidate.gi][candidate.ai];
    groups[candidate.gi][candidate.ai] = groups[candidate.gj][candidate.bj];
    groups[candidate.gj][candidate.bj] = temp;
    bestS = candidate.score;
    best = groups.map((group) => group.slice());
  }
  groups = best;

  // 4. 组装输出
  const out = [];
  for (let gi = 0; gi < N; gi++) {
    const g = groups[gi].slice().sort((a, b) => mmr(b) - mmr(a) || a._groupOrder - b._groupOrder);
    out.push({
      idx: gi,
      captain: g[0] || null,
      avgMmr: Math.round(avg(g)),
      missingRoles: missingRoles(g),
      members: g.map((p) => ({
        openid: p.openid,
        nickname: p.nickname,
        mmr: p.mmr,
        ...registrationDotaFields(p),
        roles: p.roles || [],
        signature: p.signature || '',
      })),
    });
  }
  return {
    groups: out,
    maxDiff: Math.round(bestS.maxD),
    maxAvgMmr: Math.round(bestS.maxAvg),
    minAvgMmr: Math.round(bestS.minAvg),
    avgMmrDiff: Math.round(bestS.maxD),
    maxDiffOk: bestS.maxD <= 200,
  };
}

module.exports = { runAutoGroup };
