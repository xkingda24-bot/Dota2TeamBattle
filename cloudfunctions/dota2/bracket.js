/**
 * 双败淘汰赛程生成器（Dota2 国际邀请赛 TI 赛制，无总决赛重置）
 *
 * 支持任意队伍数量（N >= 2）：
 *  - 队伍数为 2 的幂时生成标准 TI 对阵；
 *  - 非 2 的幂时自动插入轮空（首轮轮空的队伍胜者组下一轮再登场）。
 *
 * 每个 match 结构：
 * {
 *   id: 数字编号（按构造顺序自增，编号靠前的比赛必定先于其下游比赛构造），
 *   stage: 'UB1' | 'UB2' ... | 'UBF' | 'LB1' ... | 'LBF' | 'GF',
 *   label: '胜者组第一轮' / '胜者组决赛' / '败者组第一轮' / '败者组决赛' / '总决赛',
 *   teamA: 输入源 | null,
 *   teamB: 输入源 | null,
 *   bo: 'BO1'（默认，本场比赛管理者可改为 BO3/BO5）,
 *   status: 'pending' | 'done',
 *   winner: null | 队伍标识,
 *   scoreA: null | 数字,
 *   scoreB: null | 数字,
 *   next: { matchId, slot: 'A' | 'B' } | null,      // 胜者去向（null 表示没有下一场，即总决赛）
 *   loserNext: { matchId, slot: 'A' | 'B' } | null,  // 败者去向（null 表示被淘汰）
 *   isChampionMatch: false | true                    // 总决赛
 * }
 *
 * 输入源（teamA / teamB / 上游 feed）：
 *   { type: 'team',  openid: 队伍标识, name: 队伍名 }                    种子队伍直接落位
 *   { type: 'match', matchId: 比赛编号, slot: 'winner' | 'loser' }       来自某场比赛的胜者 / 败者
 */

const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六'];

function cn(n) {
  if (n >= 1 && n <= 16) return CN_NUM[n];
  return String(n);
}

/**
 * @param {Array<{openid:string, name:string}>} teams 有序队伍（openid 为队伍唯一标识，name 为队伍显示名）
 * @returns {Array} matches
 */
function buildBracket(teams) {
  const N = teams.length;
  if (!Array.isArray(teams) || N < 2) {
    throw new Error('队伍数量不足（至少 2 支队伍）');
  }

  const matches = [];
  const byId = {}; // matchId -> match，用于回填 next / loserNext
  let cid = 0;
  const newId = () => ++cid;

  const teamSource = (team) => ({
    type: 'team',
    openid: team.openid,
    name: team.name,
    teamIcon: team.teamIcon || '',
  });
  const matchSource = (matchId, slot) => ({ type: 'match', matchId, slot });

  // 把输入源放入某个 match 的 A/B 位，同时回填上游比赛的输出接线
  function placeIntoMatch(match, src, slot) {
    if (slot === 'A') match.teamA = src;
    else match.teamB = src;
    if (src && src.type === 'match') {
      const feeder = byId[src.matchId];
      if (!feeder) return;
      if (src.slot === 'winner') feeder.next = { matchId: match.id, slot };
      else feeder.loserNext = { matchId: match.id, slot };
    }
  }

  // 把一串输入源两两配对成比赛；奇数个时最后一个是轮空，直接晋级
  function pair(sources, stage, label) {
    const ms = [];
    const adv = [];
    for (let i = 0; i + 1 < sources.length; i += 2) {
      const id = newId();
      const m = {
        id,
        stage,
        label,
        teamA: null,
        teamB: null,
        bo: 'BO1',
        status: 'pending',
        winner: null,
        scoreA: null,
        scoreB: null,
        next: null,
        loserNext: null,
        isChampionMatch: false,
      };
      placeIntoMatch(m, sources[i], 'A');
      placeIntoMatch(m, sources[i + 1], 'B');
      ms.push(m);
      byId[id] = m;
      matches.push(m);
      adv.push(matchSource(id, 'winner'));
    }
    if (sources.length % 2 === 1) adv.push(sources[sources.length - 1]); // 轮空
    return { ms, adv };
  }

  // ---------- 胜者组 ----------
  const ubRounds = []; // [{ round, ms }]
  let ubSources = teams.map(teamSource);
  let roundNo = 1;
  while (ubSources.length > 1) {
    const isFinal = ubSources.length === 2;
    const stage = isFinal ? 'UBF' : roundNo === 1 ? 'UB1' : 'UB' + roundNo;
    const label = isFinal ? '胜者组决赛' : '胜者组第' + cn(roundNo) + '轮';
    const { ms, adv } = pair(ubSources, stage, label);
    ubRounds.push({ round: roundNo, ms });
    ubSources = adv;
    roundNo++;
  }
  const p = ubRounds.length; // 胜者组轮数（含决赛）

  // ---------- 总决赛 ----------
  if (p === 1) {
    // 只有 2 支队伍：胜者组决赛即总决赛
    const only = ubRounds[0].ms[0];
    only.stage = 'GF';
    only.label = '总决赛';
    only.isChampionMatch = true;
    return matches;
  }

  // ---------- 败者组 ----------
  const lbRounds = [];
  // 败者组第一轮 = 胜者组第一轮的全部败者
  let lbSurvivors = ubRounds[0].ms.map((m) => matchSource(m.id, 'loser'));
  const totalLbRounds = 2 * p - 2;
  for (let j = 1; j <= totalLbRounds; j++) {
    let participants = lbSurvivors;
    if (j % 2 === 0) {
      // 偶数轮接入下一轮胜者组的败者：LB2 ← UB2 败者，LB4 ← UB3 败者，LB6 ← 胜者组决赛败者 ...
      const ubIdx = j / 2; // 0 基：j=2 → ubRounds[1]（第2轮），j=4 → ubRounds[2]，j=6 → ubRounds[3]
      const ubLosers = ubRounds[ubIdx].ms.map((m) => matchSource(m.id, 'loser'));
      // 交错配对：败者组幸存者与胜者组败者逐对交叉，避免同组自打（TI 规则）
      const merged = [];
      const len = Math.max(lbSurvivors.length, ubLosers.length);
      for (let i = 0; i < len; i++) {
        if (i < lbSurvivors.length) merged.push(lbSurvivors[i]);
        if (i < ubLosers.length) merged.push(ubLosers[i]);
      }
      participants = merged;
    }
    const isLast = j === totalLbRounds;
    const stage = isLast ? 'LBF' : 'LB' + j;
    const label = isLast ? '败者组决赛' : '败者组第' + cn(j) + '轮';
    const { ms, adv } = pair(participants, stage, label);
    lbRounds.push({ round: j, ms });
    lbSurvivors = adv;
  }

  // ---------- 总决赛 ----------
  const gfId = newId();
  const gf = {
    id: gfId,
    stage: 'GF',
    label: '总决赛',
    teamA: null,
    teamB: null,
    bo: 'BO1',
    status: 'pending',
    winner: null,
    scoreA: null,
    scoreB: null,
    next: null,
    loserNext: null,
    isChampionMatch: true,
  };
  placeIntoMatch(gf, ubSources[0], 'A'); // 胜者组冠军
  placeIntoMatch(gf, lbSurvivors[0], 'B'); // 败者组冠军
  byId[gfId] = gf;
  matches.push(gf);

  return matches;
}

/**
 * 单败淘汰赛程生成器（单败赛制：输一场即淘汰，不设三四名决赛，也不设名次排位赛）
 *
 * 与双败共用同一套 stage 前缀，前端筛选与名次计算可直接复用：
 *   'UB1' | 'UB2' ... | 'GF'
 * 最后一轮直接标记为总决赛（isChampionMatch），不产生 UBF；所有 loserNext 恒为 null。
 *
 * @param {Array<{openid:string, name:string}>} teams 有序队伍（已按落位排序）
 * @returns {Array} matches
 */
function buildSingleElimination(teams) {
  if (!Array.isArray(teams) || teams.length < 2) {
    throw new Error('队伍数量不足（至少 2 支队伍）');
  }

  const matches = [];
  const byId = {};
  let cid = 0;
  const newId = () => ++cid;

  const teamSource = (team) => ({
    type: 'team',
    openid: team.openid,
    name: team.name,
    teamIcon: team.teamIcon || '',
  });
  const matchSource = (matchId, slot) => ({ type: 'match', matchId, slot });

  function placeIntoMatch(match, src, slot) {
    if (slot === 'A') match.teamA = src;
    else match.teamB = src;
    if (src && src.type === 'match') {
      const feeder = byId[src.matchId];
      if (!feeder) return;
      feeder.next = { matchId: match.id, slot };
    }
  }

  // 两两配对；奇数个时最后一个是轮空，直接晋级下一轮
  function pair(sources, stage, label, isFinal) {
    const adv = [];
    for (let i = 0; i + 1 < sources.length; i += 2) {
      const id = newId();
      const m = {
        id,
        stage,
        label,
        teamA: null,
        teamB: null,
        bo: 'BO1',
        status: 'pending',
        winner: null,
        scoreA: null,
        scoreB: null,
        next: null,
        loserNext: null,
        isChampionMatch: !!isFinal,
      };
      placeIntoMatch(m, sources[i], 'A');
      placeIntoMatch(m, sources[i + 1], 'B');
      byId[id] = m;
      matches.push(m);
      adv.push(matchSource(id, 'winner'));
    }
    if (sources.length % 2 === 1) adv.push(sources[sources.length - 1]);
    return adv;
  }

  let sources = teams.map(teamSource);
  let roundNo = 1;
  while (sources.length > 1) {
    const isFinal = sources.length === 2;
    const stage = isFinal ? 'GF' : roundNo === 1 ? 'UB1' : 'UB' + roundNo;
    // 轮次文案：最后一轮=总决赛；剩下 3~4 支队伍的那一轮=半决赛；其余=第 N 轮
    const label = isFinal ? '总决赛' : sources.length <= 4 ? '半决赛' : '第' + cn(roundNo) + '轮';
    sources = pair(sources, stage, label, isFinal);
    roundNo++;
  }

  return matches;
}

/**
 * 解析落位顺序：落位表合法则原样使用，否则退回队伍原始顺序。
 *
 * 队伍原始顺序的含义：系统分组模式下 teams 按组号 1..N 写入（第1组、第2组……），
 * 队长模式下按队长顺序写入。因此默认首轮就是「第1组打第2组」「第3组打第4组」……
 * 只有管理员显式「随机排位」才会打乱这个顺序。
 *
 * @param {number} teamCount 队伍数
 * @param {Array<number>|null} seeding 落位表：seeding[位次] = 队伍下标
 * @returns {Array<number>} 队伍下标顺序，长度等于队伍数
 */
function resolveSeeding(teamCount, seeding) {
  const n = Number(teamCount) || 0;
  const valid = Array.isArray(seeding) && seeding.length === n &&
    seeding.every((idx) => Number.isInteger(idx) && idx >= 0 && idx < n) &&
    new Set(seeding).size === n;
  return valid ? seeding.slice() : Array.from({ length: n }, (_, i) => i);
}

/** 按落位顺序取队伍数组；首轮由此相邻两两配对 */
function orderTeamsBySeeding(teams, seeding) {
  const list = Array.isArray(teams) ? teams : [];
  return resolveSeeding(list.length, seeding).map((idx) => list[idx]);
}

module.exports = { buildBracket, buildSingleElimination, resolveSeeding, orderTeamsBySeeding };
