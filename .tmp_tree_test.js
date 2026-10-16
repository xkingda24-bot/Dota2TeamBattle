module.exports = (function(){  return function(matches) {
    if (!matches.length) return { nodes: [], lines: [], w: 1200, h: 800 };
    const ORDER = ['UB1', 'UB2', 'UB3', 'UB4', 'UBF', 'GF', 'LB1', 'LB2', 'LB3', 'LB4', 'LBF'];
    const isUB = (s) => s === 'GF' || s.indexOf('UB') === 0;
    const isLB = (s) => s.indexOf('LB') === 0;
    const ubMatches = matches.filter((m) => isUB(m.stage));
    const lbMatches = matches.filter((m) => isLB(m.stage));
    const stageRank = (s) => {
      const i = ORDER.indexOf(s);
      return i < 0 ? 999 : i;
    };
    const ubStagesAll = [...new Set(ubMatches.map((m) => m.stage))].sort((a, b) => stageRank(a) - stageRank(b));
    const ubStages = ubStagesAll.filter((s) => s !== 'GF'); // GF 单独放最右列
    const lbStages = [...new Set(lbMatches.map((m) => m.stage))].sort((a, b) => stageRank(a) - stageRank(b));
    const gfMatch = matches.find((m) => m.stage === 'GF') || null;
    const COLS = Math.max(ubStages.length, lbStages.length);
    const NODE_W = 340;
    const NODE_H = 180;
    const GAP = 70;
    const ZONE_GAP = 150;
    const PAD = 30;
    const COL_W = NODE_W + 50;
    const ubMaxRows = Math.max.apply(null, ubStages.map((s) => ubMatches.filter((m) => m.stage === s).length).concat([1]));
    const lbMaxRows = Math.max.apply(null, lbStages.map((s) => lbMatches.filter((m) => m.stage === s).length).concat([1]));
    const ubH = PAD + ubMaxRows * (NODE_H + GAP);
    const lbH = PAD + lbMaxRows * (NODE_H + GAP);
    const H = ubH + ZONE_GAP + lbH + PAD;
    const W = PAD * 2 + (COLS + (gfMatch ? 1 : 0)) * COL_W;

    const nodeById = {};
    matches.forEach((m) => {
      nodeById[m.id] = m;
    });

    // 每列均布起始 y（胜者组区从顶部，败者组区从胜者组区下方）
    const colStartY = (stage, isLower) => {
      const n = (isLower ? lbMatches : ubMatches).filter((m) => m.stage === stage).length;
      const zoneH = isLower ? lbH : ubH;
      const base = isLower ? ubH + ZONE_GAP : 0;
      return base + (zoneH - n * (NODE_H + GAP) + GAP) / 2;
    };

    // 节点坐标：第一列均布，后续列取同区上游输入的 y 均值（形成树形汇聚）
    const pos = {};
    ubStages.forEach((s, ci) => {
      const list = ubMatches.filter((m) => m.stage === s);
      const startY = colStartY(s, false);
      list.forEach((m, i) => {
        const sameY = ['A', 'B']
          .map((sl) => m['team' + sl])
          .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
          .filter((src) => pos[src.matchId] && isUB(nodeById[src.matchId].stage))
          .map((src) => pos[src.matchId].y);
        pos[m.id] = {
          x: PAD + ci * COL_W,
          y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : startY + i * (NODE_H + GAP),
        };
      });
    });
    lbStages.forEach((s, ci) => {
      const list = lbMatches.filter((m) => m.stage === s);
      const startY = colStartY(s, true);
      list.forEach((m, i) => {
        const sameY = ['A', 'B']
          .map((sl) => m['team' + sl])
          .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
          .filter((src) => pos[src.matchId] && isLB(nodeById[src.matchId].stage))
          .map((src) => pos[src.matchId].y);
        pos[m.id] = {
          x: PAD + ci * COL_W,
          y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : startY + i * (NODE_H + GAP),
        };
      });
    });
    // 总决赛：单独放最右一列，y 取同区（胜者组）输入 UBF 的位置
    if (gfMatch) {
      const sameY = ['A', 'B']
        .map((sl) => gfMatch['team' + sl])
        .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
        .filter((src) => pos[src.matchId] && isUB(nodeById[src.matchId].stage))
        .map((src) => pos[src.matchId].y);
      pos[gfMatch.id] = {
        x: PAD + COLS * COL_W,
        y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : colStartY('GF', false),
      };
    }

    // 连线：A 位来自上游胜者（金色实线），B 位来自上游败者（灰色虚线）
    // 跨列 → 水平折线（源右边缘 → 目标左边缘）；同列（败者垂直掉落）→ 源底部竖直向下进目标顶部
    const lines = [];
    let lidx = 0;
    matches.forEach((m) => {
      const q = pos[m.id];
      if (!q) return;
      ['A', 'B'].forEach((sl) => {
        const src = m['team' + sl];
        if (!src || src.type !== 'match') return;
        const p = pos[src.matchId];
        if (!p) return;
        const win = sl === 'A';
        const added = [];
        if (q.x >= p.x + NODE_W) {
          // 跨列折线
          const x1 = p.x + NODE_W;
          const y1 = p.y + NODE_H / 2;
          const x2 = q.x;
          const y2 = q.y + NODE_H / 2;
          const xm = (x1 + x2) / 2;
          if (xm - x1 > 0) added.push({ horizontal: true, x: x1, y: y1, w: xm - x1 });
          if (y2 - y1 !== 0) {
            const hh = Math.abs(y2 - y1);
            added.push({ horizontal: false, x: xm, y: y2 - y1 > 0 ? y1 : y1 + hh, w: hh });
          }
          if (x2 - xm > 0) added.push({ horizontal: true, x: xm, y: y2, w: x2 - xm });
        } else {
          // 同列垂直掉落
          const sx = p.x + NODE_W / 2;
          const sy = p.y + NODE_H;
          const tx = q.x + NODE_W / 2;
          const ty = q.y;
          if (ty - sy !== 0) {
            const hh = Math.abs(ty - sy);
            added.push({ horizontal: false, x: sx, y: ty - sy > 0 ? sy : sy + hh, w: hh });
          }
          if (Math.abs(tx - sx) > 1) added.push({ horizontal: true, x: Math.min(sx, tx), y: ty, w: Math.abs(tx - sx) });
        }
        added.forEach((sg) => {
          lines.push({ idx: lidx++, type: win ? 'win' : 'lose', horizontal: sg.horizontal, x: sg.x, y: sg.y, w: sg.w });
        });
      });
    });

    const nodes = matches.map((m) => {
      const p = pos[m.id] || { x: 0, y: 0 };
      return {
        id: m.id,
        status: m.status,
        winner: m.winner,
        teamAInfo: m.teamAInfo,
        displayA: m.displayA,
        scoreA: m.scoreA,
        membersA: m.membersA,
        teamBInfo: m.teamBInfo,
        displayB: m.displayB,
        scoreB: m.scoreB,
        membersB: m.membersB,
        bo: m.bo,
        boRange: m.boRange,
        boIndex: m.boIndex,
        showAdmin: m.showAdmin,
        x: p.x,
        y: p.y,
      };
    });
    return { nodes, lines, w: W, h: H };
  },})();