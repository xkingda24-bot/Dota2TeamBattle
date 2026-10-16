/**
 * Dota2 群内比赛管理 - 云函数
 *
 * 所有业务逻辑都走这里（小程序端不直连数据库），
 * 身份取自微信 openid（wxContext.OPENID），天然免登录；
 * 管理员为"名单制"：首个初始化超管（superAdmin）+ 超管可添加多个管理员（admins）。
 *
 * 集合：users / tournaments / config（首次调用自动创建）
 *  config 中存：{ key:'admins', superAdmin: openid, admins: [openid...] }
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const { buildBracket } = require('./bracket');

const COLLECTIONS = ['users', 'tournaments', 'config'];
const BO_LIST = ['BO1', 'BO3', 'BO5'];
const MAX_N = 16;
const MAX_K = 5;

/* ---------------- 工具 ---------------- */

function ok(data) {
  return { success: true, data };
}

function fail(message) {
  return { success: false, message };
}

function getOpenId() {
  const wc = cloud.getWXContext();
  return wc.OPENID || '';
}

async function ensureCollections() {
  for (const c of COLLECTIONS) {
    try {
      await db.createCollection(c);
    } catch (e) {
      /* 已存在则忽略 */
    }
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getUser(openid) {
  if (!openid) return null;
  // 云函数端创建的记录不会自动带 _openid（管理端行为），先按 _openid 查，再按显式 openid 字段查
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  const res2 = await db.collection('users').where({ openid }).limit(1).get();
  return res2.data && res2.data.length ? res2.data[0] : null;
}

async function getTournamentById(id) {
  try {
    const res = await db.collection('tournaments').doc(id).get();
    return res.data || null;
  } catch (e) {
    return null;
  }
}

/* ---------------- 管理员权限（名单制） ---------------- */

async function getAdminsConfig() {
  const res = await db.collection('config').where({ key: 'admins' }).limit(1).get();
  if (res.data && res.data.length) return res.data[0];
  return { key: 'admins', superAdmin: '', admins: [] };
}

async function isAdmin(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin || (cfg.admins || []).indexOf(openid) >= 0;
}

async function isSuper(openid) {
  const cfg = await getAdminsConfig();
  return openid === cfg.superAdmin;
}

async function isAdminUser() {
  return isAdmin(getOpenId());
}

/* ---------------- 对阵解析 ---------------- */

/* 解析对阵：把每个比赛的队伍源解析为实际队伍信息（含昵称），并给出显示名 */
function resolveBracket(tournament) {
  const w = {}; // matchId -> {openid, name}
  const l = {};
  const resolveSource = (src) => {
    if (!src) return null;
    if (src.type === 'team') return { openid: src.openid, name: src.name };
    const map = src.slot === 'winner' ? w : l;
    return map[src.matchId] || null;
  };
  const ms = (tournament.matches || []).map((m) => {
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

/* 组装比赛页完整数据 */
async function composeTournament(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  // 系统分组模式无队长名额；队员名额 = 队伍数 × 每组人数（K）
  const captainTotal = mode === 'auto' ? 0 : t.N;
  const playerTotal = t.N * t.K;
  const waitLimit = t.waitLimit || 0;
  const captains = (t.registrations || []).filter((r) => r.role === 'captain');
  const players = (t.registrations || []).filter((r) => r.role === 'player');
  const waitlist = (t.registrations || []).filter((r) => r.role === 'waitlist');
  const myReg = (t.registrations || []).find((r) => r.openid === myOpenid) || null;
  const admin = await isAdmin(myOpenid);
  const superFlag = await isSuper(myOpenid);

  // 选人信息（仅队长选人模式）
  let draftInfo = null;
  if (mode === 'captain' && t.draft && (t.status === 'draft' || t.status === 'battle')) {
    const picks = t.draft.picks || [];
    const playerRegMap = {};
    players.forEach((r) => (playerRegMap[r.openid] = r));
    const turn = t.draft.turn || 0;
    const totalPicks = t.N * t.K;
    const round = Math.floor(turn / t.N) + 1;
    const inRoundIdx = turn % t.N;
    const capIdx = round % 2 === 1 ? inRoundIdx : t.N - 1 - inRoundIdx;
    const currentCaptain = turn < totalPicks ? (t.captainOrder || [])[capIdx] : null;
    const pickedPlayerIds = {};
    picks.forEach((arr) => arr.forEach((p) => (pickedPlayerIds[p] = true)));
    draftInfo = {
      turn,
      totalPicks,
      done: turn >= totalPicks,
      round,
      capIdx,
      currentCaptain, // {openid, nickname} | null
      captainOrder: t.captainOrder || [],
      picks: picks.map((arr, i) => ({
        teamIndex: i,
        captain: (t.captainOrder || [])[i] || null,
        players: arr.map((p) => playerRegMap[p] || { openid: p, nickname: '队员' }),
      })),
      remainingPlayers: players.filter((p) => !pickedPlayerIds[p.openid]),
    };
  }

  // 队伍信息
  let teams = t.teams || null;
  if (!teams && t.captainOrder && t.draft) {
    teams = (t.captainOrder || []).map((cap, i) => ({
      captain: cap,
      players: (t.draft.picks || [])[i] || [],
    }));
  }

  return {
    id: t._id,
    name: t.name,
    time: t.time,
    mode,
    N: t.N,
    K: t.K,
    status: t.status,
    champion: t.champion || null,
    creatorName: t.creatorName || '',
    secret: admin ? t.secret : '', // 暗号仅管理员可见
    myOpenid,
    isAdmin: admin,
    isSuper: superFlag,
    captainFilled: captains.length,
    captainTotal,
    playerFilled: players.length,
    playerTotal,
    waitlistFilled: waitlist.length,
    waitLimit,
    registrations: t.registrations || [],
    myReg,
    draftInfo,
    teams,
    seeding: t.seeding || null,
    matches: resolveBracket(t),
    createdAt: t.createdAt,
    archivedAt: t.archivedAt || null,
  };
}

/* 比赛列表摘要 */
function summarize(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const caps = (t.registrations || []).filter((r) => r.role === 'captain').length;
  const players = (t.registrations || []).filter((r) => r.role === 'player').length;
  return {
    id: t._id,
    name: t.name,
    time: t.time,
    mode,
    N: t.N,
    K: t.K,
    status: t.status,
    captainFilled: caps,
    captainTotal: mode === 'auto' ? 0 : t.N,
    playerFilled: players,
    playerTotal: t.N * t.K,
    champion: t.champion || null,
    creatorName: t.creatorName || '',
    createdAt: t.createdAt,
    archivedAt: t.archivedAt || null,
    meRegistered: myOpenid ? (t.registrations || []).some((r) => r.openid === myOpenid) : false,
  };
}

/* ---------------- 动作 ---------------- */

/* 系统分组算法：
   1) 位置代表构建：每组依次从 1-5 号位各选一名会该位置的队员（优先均分均衡）
   2) 补位：每组补到 K 人，优先补该组缺失的位置
   3) 爬山优化：随机交换两人，组间均分差更小（且缺位不增加）则接受
   返回预览结构（含每组名单/均分/缺位） */
function runAutoGroup(players, N, K) {
  const has = (p, r) => Array.isArray(p.roles) && p.roles.indexOf(r) >= 0;
  const missingRoles = (g) => {
    const s = new Set();
    g.forEach((p) => (p.roles || []).forEach((r) => s.add(r)));
    const m = [];
    for (let r = 1; r <= 5; r++) if (!s.has(r)) m.push(r);
    return m;
  };
  const avg = (g) => (g.length ? g.reduce((s, p) => s + (p.mmr || 0), 0) / g.length : 0);

  let groups = [];
  for (let i = 0; i < N; i++) groups.push([]);
  const pool = players.map((p) => Object.assign({}, p));

  // 1. 位置代表：每组依次拿 1-5 号位人选（同位置候选里选 mmr 与当前组均值最接近的）
  for (let r = 1; r <= 5; r++) {
    for (let gi = 0; gi < N; gi++) {
      if (groups[gi].length >= K) continue;
      const cand = pool.filter((p) => has(p, r));
      if (!cand.length) continue; // 全局无人会该位置 → 该组缺位
      const curAvg = groups[gi].length ? avg(groups[gi]) : null;
      let pick = cand[0];
      let bestD = Infinity;
      cand.forEach((p) => {
        const d = curAvg == null ? 0 : Math.abs((p.mmr || 0) - curAvg);
        if (d < bestD) {
          bestD = d;
          pick = p;
        }
      });
      groups[gi].push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
  }

  // 2. 补位：每组补到 K 人，优先补该组缺失位置的人
  for (let gi = 0; gi < N; gi++) {
    while (groups[gi].length < K && pool.length) {
      const miss = missingRoles(groups[gi]);
      let pick = null;
      for (let r of miss) {
        const c = pool.filter((p) => has(p, r));
        if (c.length) {
          pick = c[0];
          break;
        }
      }
      if (!pick) pick = pool[0];
      groups[gi].push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
  }

  // 3. 爬山优化：随机交换，均分差变小（同分则缺位变少）才接受
  const score = () => {
    const av = groups.map(avg);
    const maxD = Math.max.apply(null, av) - Math.min.apply(null, av);
    const missN = groups.reduce((s, g) => s + missingRoles(g).length, 0);
    return { maxD, missN };
  };
  let bestS = score();
  let best = groups.map((g) => g.slice());
  for (let iter = 0; iter < 4000; iter++) {
    const gi = Math.floor(Math.random() * N);
    let gj = Math.floor(Math.random() * N);
    if (gj === gi) gj = (gj + 1) % N;
    const ai = Math.floor(Math.random() * groups[gi].length);
    const bj = Math.floor(Math.random() * groups[gj].length);
    const tmp = groups[gi][ai];
    groups[gi][ai] = groups[gj][bj];
    groups[gj][bj] = tmp;
    const s = score();
    // 缺位优先（位置覆盖不牺牲），缺位相同再优化组间均分差
    if (s.missN < bestS.missN || (s.missN === bestS.missN && s.maxD < bestS.maxD)) {
      bestS = s;
      best = groups.map((g) => g.slice());
    } else {
      const tmp2 = groups[gi][ai];
      groups[gi][ai] = groups[gj][bj];
      groups[gj][bj] = tmp2;
    }
  }
  groups = best;

  // 4. 组装输出
  const out = [];
  for (let gi = 0; gi < N; gi++) {
    const g = groups[gi].slice().sort((a, b) => (b.mmr || 0) - (a.mmr || 0));
    out.push({
      idx: gi,
      captain: g[0] || null,
      avgMmr: Math.round(avg(g)),
      missingRoles: missingRoles(g),
      members: g.map((p) => ({
        openid: p.openid,
        nickname: p.nickname,
        mmr: p.mmr,
        roles: p.roles || [],
        signature: p.signature || '',
      })),
    });
  }
  return { groups: out, maxDiff: Math.round(bestS.maxD), maxDiffOk: bestS.maxD <= 300 };
}

const actions = {
  /* 主页数据：今天的比赛 + 之前的比赛 + 我的身份 */
  async home(event) {
    const openid = getOpenId();
    const [user, cfg] = await Promise.all([getUser(openid), getAdminsConfig()]);
    const isAdminFlag = openid === cfg.superAdmin || (cfg.admins || []).indexOf(openid) >= 0;
    const isSuperFlag = openid === cfg.superAdmin;
    // 客户端传入"今天 0 点"的时间戳，避免云函数时区差异
    const todayStart = Number(event.todayStart) || 0;
    const todayRes = await db
      .collection('tournaments')
      .where(todayStart ? { createdAt: _.gte(todayStart) } : {})
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();
    const olderRes = await db
      .collection('tournaments')
      .where(todayStart ? { createdAt: _.lt(todayStart) } : { createdAt: _.lt(0) })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    const todayRaw = (todayRes.data || []).map((t) => summarize(t, openid));
    const olderRaw = (olderRes.data || []).map((t) => summarize(t, openid));
    return ok({
      user,
      isAdmin: isAdminFlag,
      isSuper: isSuperFlag,
      hasSuper: !!cfg.superAdmin,
      // 已归档（archivedAt 非空）的比赛从"今天"移入历史，未归档的保留在主页
      today: todayRaw.filter((x) => !x.archivedAt),
      older: todayRaw.filter((x) => x.archivedAt).concat(olderRaw),
    });
  },

  /* 完善/更新我的资料（昵称 + 天梯分 + 常玩位置 + 个人签名）；天梯分与常玩位置为必填 */
  async saveProfile(event) {
    const openid = getOpenId();
    const nickname = String(event.nickname || '').trim();
    if (!nickname) return fail('昵称不能为空');
    if (nickname.length > 20) return fail('昵称最多 20 个字');
    // 天梯分（必填，0-20000）
    const mmrRaw = String(event.mmr == null ? '' : event.mmr).trim();
    if (mmrRaw === '') return fail('请填写天梯分');
    const mmr = Math.round(Number(mmrRaw));
    if (!isFinite(mmr) || mmr < 0 || mmr > 20000) return fail('天梯分需在 0-20000 之间');
    // 常玩位置（必填，1-5 至少选一个）
    let roles = [];
    if (Array.isArray(event.roles)) {
      roles = Array.from(new Set(event.roles.map((v) => Number(v)).filter((v) => v >= 1 && v <= 5))).sort(
        (a, b) => a - b
      );
    }
    if (roles.length === 0) return fail('请至少选择一个常玩位置');
    // 个人签名（选填，不超过 15 个字）
    const signature = String(event.signature || '').trim();
    if (signature.length > 15) return fail('个人签名最多 15 个字');

    // 先定位自己的记录（兼容：老记录只有 _openid，新记录有显式 openid 字段）
    const me = await getUser(openid);

    // 新昵称查重：仅当该昵称属于"别人"时拒绝（自己当前昵称、自己的旧记录不算）
    const dup = await db.collection('users').where({ nickname }).limit(1).get();
    if (dup.data && dup.data.length) {
      const dupRec = dup.data[0];
      const dupOwner = dupRec.openid || dupRec._openid || '';
      const isSelf = me ? dupRec._id === me._id : dupOwner === openid;
      if (!isSelf && dupOwner && dupOwner !== openid) return fail('该昵称已被使用，请换一个');
    }

    const data = { openid, nickname, mmr, roles, signature, updatedAt: Date.now() };
    if (me) {
      // 更新自己的记录（改昵称 = 更新，不再新增）
      await db.collection('users').doc(me._id).update({ data });
      // 清理同 openid 的历史重复记录（只保留 me._id 这条），修复旧 bug 产生的孤儿数据
      const dupRes = await db.collection('users').where({ openid }).get();
      const dels = (dupRes.data || []).filter((r) => r._id !== me._id);
      for (const r of dels) {
        try {
          await db.collection('users').doc(r._id).remove();
        } catch (e) {
          /* 忽略并发删除 */
        }
      }
    } else {
      await db.collection('users').add({
        data: Object.assign({}, data, { createdAt: Date.now() }),
      });
    }
    return ok({ nickname, mmr, roles, signature });
  },

  /* 初始化超管：系统内还没有超管时，首个调用者成为最高权限管理员 */
  async initSuperAdmin() {
    const openid = getOpenId();
    const cfg = await getAdminsConfig();
    if (cfg.superAdmin) return fail('最高管理员已初始化');
    const me = await getUser(openid);
    if (!me) return fail('请先设置昵称再初始化');
    await db.collection('config').where({ key: 'admins' }).remove();
    await db.collection('config').add({
      data: { key: 'admins', superAdmin: openid, admins: [], createdAt: Date.now() },
    });
    return ok({ isSuper: true });
  },

  /* 管理员名单（所有用户可看）；超管可管理 */
  async getStaff() {
    const openid = getOpenId();
    const cfg = await getAdminsConfig();
    const ids = [cfg.superAdmin].concat(cfg.admins || []).filter(Boolean);
    const members = [];
    for (const id of ids) {
      const u = await getUser(id);
      members.push({ openid: id, nickname: u ? u.nickname : '未设置昵称' });
    }
    return ok({
      user: await getUser(openid),
      superAdminOpenid: cfg.superAdmin,
      superAdmin: members.find((m) => m.openid === cfg.superAdmin) || null,
      admins: members.filter((m) => m.openid !== cfg.superAdmin),
      isAdmin: await isAdmin(openid),
      isSuper: await isSuper(openid),
    });
  },

  /* 超管：添加管理员（按 openid 或昵称） */
  async addAdmin(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以添加管理员');
    let targetOpenid = String(event.openid || '').trim();
    let target = null;
    if (targetOpenid) {
      target = await getUser(targetOpenid);
      if (!target) return fail('未找到该用户');
    } else {
      const nickname = String(event.nickname || '').trim();
      if (!nickname) return fail('请输入要添加的用户昵称');
      const res = await db.collection('users').where({ nickname }).limit(1).get();
      if (!res.data || !res.data.length) return fail('没有找到昵称为「' + nickname + '」的用户（对方需先设置昵称）');
      target = res.data[0];
      targetOpenid = target.openid || target._openid || '';
    }
    if (!targetOpenid) return fail('无法识别该用户的身份，请让对方重新设置一次昵称');
    if (targetOpenid === openid) return fail('你已经是最高管理员');
    const cfg = await getAdminsConfig();
    if ((cfg.admins || []).indexOf(targetOpenid) >= 0) return fail('该用户已是管理员');
    const admins = (cfg.admins || []).concat([targetOpenid]);
    await db.collection('config').doc(cfg._id).update({ data: { admins } });
    return ok(true);
  },

  /* 超管：用户列表（用于从列表选择添加管理员，排除自己和已有管理员） */
  async listUsers() {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以查看用户列表');
    const cfg = await getAdminsConfig();
    const excluded = new Set([cfg.superAdmin].concat(cfg.admins || []).filter(Boolean));
    const res = await db.collection('users').orderBy('nickname', 'asc').limit(100).get();
    const users = (res.data || [])
      .filter((u) => {
        const id = u.openid || u._openid || '';
        return !!id && !!u.nickname && !excluded.has(id);
      })
      .map((u) => ({
        openid: u.openid || u._openid || '',
        nickname: u.nickname || '',
        mmr: u.mmr || null,
        roles: u.roles || [],
      }));
    return ok({ users });
  },

  /* 超管：移除管理员 */
  async removeAdmin(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以移除管理员');
    const targetOpenid = event.openid;
    if (targetOpenid === openid) return fail('不能移除自己（最高管理员）');
    const cfg = await getAdminsConfig();
    const admins = (cfg.admins || []).filter((id) => id !== targetOpenid);
    if (admins.length === (cfg.admins || []).length) return fail('该用户不是管理员');
    await db.collection('config').doc(cfg._id).update({ data: { admins } });
    return ok(true);
  },

  /* 创建比赛（管理员）：支持多场并行，报名需暗号 */
  async createTournament(event) {
    if (!(await isAdminUser())) return fail('只有管理员可以创建比赛');
    const name = String(event.name || '').trim();
    const time = String(event.time || '').trim();
    const secret = String(event.secret || '').trim();
    const mode = event.mode === 'auto' ? 'auto' : 'captain'; // captain=队长选人 auto=系统分组
    const N = Number(event.N);
    const K = Number(event.K);
    const waitLimit = Number(event.waitLimit);
    if (!name) return fail('请填写比赛名称');
    if (!secret) return fail('请设置报名暗号');
    if (secret.length > 20) return fail('暗号最多 20 个字');
    if (N < 2 || N > MAX_N) return fail('队伍数量需在 2-' + MAX_N + ' 之间');
    if (K < 1 || K > MAX_K) return fail(mode === 'auto' ? '每组人数需在 1-' + MAX_K + ' 之间' : '每个队长选队友数量需在 1-' + MAX_K + ' 之间');
    if (!isFinite(waitLimit) || waitLimit < 0 || waitLimit > 20) return fail('替补数量需在 0-20 之间');
    const openid = getOpenId();
    const me = await getUser(openid);
    const res = await db.collection('tournaments').add({
      data: {
        name,
        time,
        secret,
        mode,
        N,
        K,
        waitLimit: Math.round(waitLimit),
        status: 'registration',
        registrations: [],
        captainOrder: [],
        draft: null,
        teams: [],
        seeding: null,
        matches: [],
        champion: null,
        createdAt: Date.now(),
        createdBy: openid,
        creatorName: me ? me.nickname : '',
      },
    });
    return ok({ id: res._id });
  },

  /* 管理员：修改报名阶段的比赛配置（名称/时间/暗号/模式/队伍数/每队人数或队友数/替补数） */
  async updateConfig(event) {
    if (!(await isAdminUser())) return fail('只有管理员可以修改配置');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以修改配置');
    const name = String(event.name || '').trim();
    const time = String(event.time || '').trim();
    const secret = String(event.secret || '').trim();
    const mode = event.mode === 'auto' ? 'auto' : 'captain';
    const N = Number(event.N);
    const K = Number(event.K);
    const waitLimit = Number(event.waitLimit);
    if (!name) return fail('请填写比赛名称');
    if (!secret) return fail('请设置报名暗号');
    if (secret.length > 20) return fail('暗号最多 20 个字');
    if (N < 2 || N > MAX_N) return fail('队伍数量需在 2-' + MAX_N + ' 之间');
    if (K < 1 || K > MAX_K) return fail(mode === 'auto' ? '每组人数需在 1-' + MAX_K + ' 之间' : '每个队长选队友数量需在 1-' + MAX_K + ' 之间');
    if (!isFinite(waitLimit) || waitLimit < 0 || waitLimit > 20) return fail('替补数量需在 0-20 之间');
    // 名额不能小于已报名人数
    const captains = (t.registrations || []).filter((r) => r.role === 'captain').length;
    const players = (t.registrations || []).filter((r) => r.role === 'player').length;
    const waitlist = (t.registrations || []).filter((r) => r.role === 'waitlist').length;
    // 系统分组模式无队长名额
    if (mode === 'auto') {
      if (captains > 0) return fail('已有队长报名，不能切换为系统分组模式（请先移除队长报名）');
      if (N * K < players) return fail('队员名额不能小于已报名人数（当前已报 ' + players + ' 人）');
    } else {
      if (N < captains) return fail('已有 ' + captains + ' 位队长报名，队长数不能小于 ' + captains);
      if (N * K < players) return fail('队员名额不能小于已报名人数（当前已报 ' + players + ' 人）');
    }
    if (waitLimit < waitlist) return fail('替补名额不能小于已报名替补人数（当前 ' + waitlist + ' 人）');
    await db.collection('tournaments').doc(t._id).update({
      data: { name, time, secret, mode, N, K, waitLimit: Math.round(waitLimit), updatedAt: Date.now() },
    });
    return ok({});
  },

  /* 报名暗号校验 */
  async checkSecret(event) {
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    return ok({ correct: String(event.secret || '') === String(t.secret || '') });
  },

  /* 报名（需暗号）：队长/队员/替补；队员满时自动进入替补；资料（昵称/天梯分/常玩位置）必填才可报名 */
  async register(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me || !me.nickname) return fail('请先设置昵称');
    if (me.mmr == null) return fail('请先在「我的-编辑资料」填写天梯分后再报名');
    if (!Array.isArray(me.roles) || me.roles.length === 0) return fail('请先在「我的-编辑资料」选择常玩位置后再报名');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    if (String(event.secret || '') !== String(t.secret || '')) return fail('报名暗号错误');
    if ((t.registrations || []).some((r) => r.openid === openid)) return fail('你已经报名过了');
    const waitLimit = t.waitLimit || 0;
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const waitlist = (t.registrations || []).filter((r) => r.role === 'waitlist');
    let role = 'player';
    let auto = false;
    if (event.role === 'captain') {
      if (t.mode === 'auto') return fail('本场比赛为系统分组模式，请报名队员或替补');
      role = 'captain';
      if (captains.length >= t.N) return fail('队长名额已满');
    } else if (event.role === 'waitlist') {
      role = 'waitlist';
      if (waitLimit <= 0) return fail('本场比赛未设置替补');
      if (waitlist.length >= waitLimit) return fail('替补名额已满');
    } else {
      if (players.length >= t.N * t.K) {
        // 队员名额已满 → 自动加入替补
        if (waitLimit <= 0) return fail('队员名额已满');
        if (waitlist.length >= waitLimit) return fail('队员名额已满，替补也已满');
        role = 'waitlist';
        auto = true;
      }
    }
    const reg = {
      openid,
      nickname: me.nickname,
      role,
      ts: Date.now(),
      mmr: me.mmr || null,
      roles: me.roles || [],
      signature: me.signature || '',
    };
    if (role === 'captain') reg.teamName = '';
    const registrations = (t.registrations || []).concat([reg]);
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok({ role, auto });
  },

  /* 设置队伍名称（队长本人或管理员；仅报名阶段，最多 10 个字） */
  async setTeamName(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以设置队伍名称');
    const teamName = String(event.teamName || '').trim();
    if (teamName.length > 10) return fail('队伍名称最多 10 个字');
    const targetOpenid = String(event.openid || '') || openid;
    const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
    const idx = registrations.findIndex((r) => r.openid === targetOpenid && r.role === 'captain');
    if (idx < 0) return fail('只能为已报名的队长设置队伍名称');
    const isAdminFlag = await isAdmin(openid);
    if (targetOpenid !== openid && !isAdminFlag) return fail('只有队长本人或管理员可以设置队伍名称');
    registrations[idx] = Object.assign({}, registrations[idx], { teamName });
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 管理员：报名阶段把队员移入替补 / 替补移回队员 */
  async moveRegistration(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('只有报名阶段可以调整名单');
    const toRole = event.toRole === 'player' ? 'player' : 'waitlist';
    const registrations = (t.registrations || []).map((r) => Object.assign({}, r));
    const idx = registrations.findIndex((r) => r.openid === event.openid);
    if (idx < 0) return fail('未找到该报名');
    const cur = registrations[idx];
    if (cur.role !== 'player' && cur.role !== 'waitlist') return fail('只能调整队员/替补');
    if (cur.role === toRole) return fail('该用户已在目标名单中');
    if (toRole === 'player') {
      const players = registrations.filter((r) => r.role === 'player').length;
      if (players >= t.N * t.K) return fail('队员名额已满，无法移入');
    } else {
      const waitLimit = t.waitLimit || 0;
      if (waitLimit <= 0) return fail('本场比赛未设置替补');
      const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
      if (waitlist >= waitLimit) return fail('替补名额已满');
    }
    registrations[idx] = Object.assign({}, cur, { role: toRole });
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 退报（报名阶段自己取消） */
  async cancelRegister(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('报名已锁定，请联系管理员');
    const registrations = (t.registrations || []).filter((r) => r.openid !== openid);
    if (registrations.length === (t.registrations || []).length) return fail('你尚未报名');
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 移除报名（管理员） */
  async removeRegistration(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const registrations = (t.registrations || []).filter((r) => r.openid !== event.openid);
    if (registrations.length === (t.registrations || []).length) return fail('未找到该报名');
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok(true);
  },

  /* 开始选人（管理员）：随机排序队长，初始化蛇形轮次 */
  async startDraft(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    if (captains.length < t.N) return fail('队长尚未报满（' + captains.length + '/' + t.N + '）');
    if (players.length < t.N * t.K) {
      return fail('队员尚未报满（' + players.length + '/' + t.N * t.K + '）');
    }
    const captainOrder = shuffle(captains).map((c) => ({
      openid: c.openid,
      nickname: c.nickname,
      teamName: c.teamName || '',
      mmr: c.mmr || null,
      roles: c.roles || [],
      signature: c.signature || '',
    }));
    await db.collection('tournaments').doc(t._id).update({
      data: {
        status: 'draft',
        captainOrder,
        draft: { turn: 0, picks: captainOrder.map(() => []) },
      },
    });
    return ok(true);
  },

  /* 队长选人 / 管理员代选 */
  async pickPlayer(event) {
    const openid = getOpenId();
    const isAdminFlag = await isAdmin(openid);
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    if (openid !== currentCaptain.openid && !isAdminFlag) {
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
        },
      });
    if (!upd.stats || upd.stats.updated !== 1) {
      return fail('选人顺序有冲突，请刷新后再试');
    }
    const done = turn + 1 >= totalPicks;
    return ok({ picked: playerOpenid, teamIndex: capIdx, done });
  },

  /* 重置选人（管理员）：重新随机队长顺序并清空已选 */
  async resetDraft(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'draft') return fail('当前不在选人阶段');
    const captains = (t.registrations || []).filter((r) => r.role === 'captain');
    const captainOrder = shuffle(captains).map((c) => ({
      openid: c.openid,
      nickname: c.nickname,
      teamName: c.teamName || '',
      mmr: c.mmr || null,
      roles: c.roles || [],
      signature: c.signature || '',
    }));
    await db.collection('tournaments').doc(t._id).update({
      data: {
        captainOrder,
        draft: { turn: 0, picks: captainOrder.map(() => []) },
      },
    });
    return ok(true);
  },

  /* 调整胜者组第一轮对阵（管理员，选人/分组完成后、生成对阵前） */
  async setSeeding(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    await db.collection('tournaments').doc(t._id).update({ data: { seeding } });
    return ok(true);
  },

  /* 随机对阵 */
  async shuffleSeeding(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
    const base = [];
    for (let i = 0; i < t.N; i++) base.push(i);
    await db.collection('tournaments').doc(t._id).update({ data: { seeding: shuffle(base) } });
    return ok(true);
  },

  /* 生成对阵、进入对战阶段（管理员） */
  async startBracket(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'draft') return fail('当前不在生成对阵阶段');
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
    const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : shuffle(teams.map((_, i) => i));
    const ordered = seeding.map((idx) => teams[idx]);
    const bracketTeams = ordered.map((team, i) => ({
      openid: 'T' + i,
      name: (team.captain.teamName || '').trim() ? team.captain.teamName : team.captain.nickname + '战队',
      captainOpenid: team.captain.openid,
    }));
    let matches;
    try {
      matches = buildBracket(bracketTeams);
    } catch (e) {
      return fail('生成对阵失败：' + e.message);
    }
    await db.collection('tournaments').doc(t._id).update({
      data: {
        status: 'battle',
        teams,
        seeding,
        matches,
        champion: null,
      },
    });
    return ok(true);
  },

  /* 配置比赛赛制（管理员） */
  async setMatchBo(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.status !== 'battle') return fail('当前不在对战阶段');
    const bo = BO_LIST.indexOf(event.bo) >= 0 ? event.bo : null;
    if (!bo) return fail('赛制只能是 BO1 / BO3 / BO5');
    const idx = (t.matches || []).findIndex((m) => m.id === Number(event.matchId));
    if (idx < 0) return fail('比赛不存在');
    if (t.matches[idx].status === 'done') return fail('比赛已结束，不能修改赛制');
    const matches = (t.matches || []).slice();
    matches[idx] = Object.assign({}, matches[idx], { bo });
    await db.collection('tournaments').doc(t._id).update({ data: { matches } });
    return ok(true);
  },

  /* 记录比赛结果（管理员）：自动晋级 / 淘汰 / 产生冠军 */
  async setMatchResult(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    if (m.isChampionMatch) {
      champion = winTeam;
      status = 'finished';
    }

    // 用 _.set 整体替换 champion 字段：TCB 的 update 会把嵌套对象展开成点路径（champion.name）
    // 而库里 champion 字段可能是 null（此前非冠军赛写入过 null），点路径更新会报
    // "Cannot create field 'name' in element {champion: null}"
    await db.collection('tournaments').doc(t._id).update({
      data: {
        matches,
        champion: _.set(champion),
        status,
        // 决赛打完标记已结束，但**不自动归档**：由管理员在主页/对战页手动归档
        archivedAt: t.archivedAt || null,
      },
    });
    return ok({ champion: champion ? champion.name : null, finished: status === 'finished' });
  },

  /* 修正比赛结果（管理员）：级联重置受影响的后续比赛 */
  async resetMatchResult(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
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
    if (champion && Array.from(resetIds).some((id) => (matches.find((x) => x.id === id) || {}).isChampionMatch)) {
      status = 'battle';
    }
    await db.collection('tournaments').doc(t._id).update({
      data: {
        matches,
        champion: _.set(status === 'battle' ? null : champion),
        status,
        archivedAt: status === 'battle' ? null : t.archivedAt || null,
      },
    });
    return ok(true);
  },

  /* 结束并归档（管理员）：手动把已结束的比赛归档到历史（要求已有冠军，未结束不能归档） */
  async finishTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.archivedAt) return fail('比赛已归档');
    if (!t.champion) return fail('比赛还未结束（未产生冠军），不能归档');
    await db.collection('tournaments').doc(t._id).update({
      data: { status: 'finished', archivedAt: Date.now() },
    });
    return ok(true);
  },

  /* 删除比赛（管理员）：放弃/清理 */
  async deleteTournament(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    await db.collection('tournaments').doc(t._id).remove();
    return ok(true);
  },

  /* 系统分组：预览分组结果（不落库）。约束：每组 K 人；尽量覆盖 1-5 号位；组间均分差尽量 ≤300 */
  async autoGroup(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    return ok(runAutoGroup(players, t.N, t.K));
  },

  /* 系统分组：确认分组并写入队伍（服务端重算，不信任客户端数据） */
  async confirmGroup(event) {
    if (!(await isAdminUser())) return fail('需要管理员权限');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    if (t.mode !== 'auto') return fail('本场比赛不是系统分组模式');
    if (t.status !== 'registration') return fail('当前不在报名阶段');
    const players = (t.registrations || []).filter((r) => r.role === 'player');
    const need = t.N * t.K;
    if (players.length < need) return fail('队员尚未报满（' + players.length + '/' + need + '），报满后才能分组');
    const result = runAutoGroup(players, t.N, t.K);
    const teams = result.groups.map((g) => ({
      captain: {
        openid: g.captain.openid,
        nickname: g.captain.nickname,
        teamName: '',
        mmr: g.captain.mmr,
        roles: g.captain.roles || [],
        signature: g.captain.signature || '',
      },
      players: g.members
        .filter((m) => m.openid !== g.captain.openid)
        .map((m) => ({
          openid: m.openid,
          nickname: m.nickname,
          mmr: m.mmr,
          roles: m.roles || [],
          signature: m.signature || '',
        })),
    }));
    await db.collection('tournaments').doc(t._id).update({
      data: { status: 'draft', teams, captainOrder: [], draft: null, seeding: null, updatedAt: Date.now() },
    });
    return ok({});
  },

  /* 生成虚拟测试用户并报名（管理员；用于自测完整流程） */
  async seedTest(event) {
    if (!(await isAdminUser())) return fail('仅管理员可生成测试数据');
    let t = null;
    if (event.id) {
      t = await getTournamentById(event.id);
    } else {
      const name = String(event.name || '').trim();
      if (!name) return fail('请传入比赛 id 或比赛名称');
      const res = await db.collection('tournaments').where({ name }).limit(1).get();
      t = res.data && res.data.length ? res.data[0] : null;
    }
    if (!t) return fail('比赛不存在');
    if (t.status !== 'registration') return fail('当前不在报名阶段（测试数据只能在报名阶段注入）');

    const VCAPS = [
      { nickname: '天府一号', mmr: 8800, roles: [1], signature: '梦想是打TI' },
      { nickname: '剑气纵横', mmr: 8300, roles: [2], signature: '中单霸主' },
      { nickname: '顽皮虎', mmr: 7900, roles: [3], signature: '一号位大腿' },
      { nickname: '竹林听风', mmr: 7500, roles: [4], signature: '四号位游走' },
      { nickname: '清欢渡', mmr: 7100, roles: [5], signature: '五号位守护神' },
      { nickname: '星夜骑士', mmr: 6800, roles: [1, 3], signature: '手残党慎选' },
      { nickname: '雾都游侠', mmr: 6500, roles: [2, 5], signature: '主打一个陪伴' },
    ];
    const VNAMES = [
      '幽鬼之刃', '虚空假面', '蓝猫淘气', '白牛冲锋', '神谕者', '潮汐猎人', '影魔登场', '屠夫钩子',
      '赏金猎人', '冰女宝宝', '火女莉娜', '风行天下', '白虎月神', '猴子猴孙', '剑圣无敌', '矮人火枪',
      '双头食人', '沙王地刺', '巫妖亡语', '术士乱斗', '先知树语', '撼地神牛', '主宰无敌', '昆卡船长',
      '巨魔战将', '刚背兽王', '谜团黑洞', '宙斯雷霆', '美杜莎之眼', '幻影长矛', '敌法师之怒', '痛苦女王',
    ];
    const SIGS = ['稳住别浪', '认真打每一把', '求个大腿带', '菜鸡互啄', '一波推平', '五号位保人', '手残但努力', '主打一个快乐'];
    const ROLE_POOL = [1, 2, 3, 4, 5];
    const pickRoles = () => {
      const n = 1 + Math.floor(Math.random() * 3);
      const arr = ROLE_POOL.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, n).sort();
    };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // 系统分组模式：补足虚拟队员到报满（不生成队长），并补足替补（最多 5 个）；位置按 1-5 轮转
    if (t.mode === 'auto') {
      const need = t.N * t.K;
      const waitLimit = t.waitLimit || 0;
      const curPlayers = (t.registrations || []).filter((r) => r.role === 'player');
      const curWait = (t.registrations || []).filter((r) => r.role === 'waitlist');
      const mkName = (i) => VNAMES[i % VNAMES.length] + (i >= VNAMES.length ? '·' + (Math.floor(i / VNAMES.length) + 1) : '');
      const mkRoles = (base) => {
        const extra = pickRoles().filter((r) => r !== base);
        return [base].concat(extra.slice(0, 1)).sort();
      };
      const vplys = [];
      if (curPlayers.length < need) {
        const count = need - curPlayers.length;
        for (let i = 0; i < count; i++) {
          const base = (i % 5) + 1;
          vplys.push({
            openid: 'vgrp' + (i + 1),
            nickname: mkName(i),
            mmr: 4000 + Math.floor(Math.random() * 5000),
            roles: mkRoles(base),
            signature: pick(SIGS),
            role: 'player',
          });
        }
      }
      const vwaits = [];
      if (waitLimit > 0 && curWait.length < waitLimit) {
        const wc = Math.min(5, waitLimit - curWait.length);
        for (let i = 0; i < wc; i++) {
          const base = ((i + 17) % 5) + 1; // 与队员错开轮转
          vwaits.push({
            openid: 'vgwa' + (i + 1),
            nickname: mkName(need + i),
            mmr: 3500 + Math.floor(Math.random() * 4500),
            roles: mkRoles(base),
            signature: pick(SIGS),
            role: 'waitlist',
          });
        }
      }
      const all = vplys.concat(vwaits);
      if (!all.length) return fail('队员与替补均已满，无需注入虚拟用户');
      const existing = (t.registrations || []).map((r) => r.openid);
      const skip = new Set(existing);
      const toAdd = all.filter((u) => !skip.has(u.openid));
      if (!toAdd.length) return fail('虚拟用户已全部报名过了（如需重新注入，请先删除本场比赛再重建）');
      const dups = await Promise.all(toAdd.map((u) => getUser(u.openid)));
      const toCreate = toAdd.filter((u, i) => !dups[i]);
      const CHUNK = 8;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        const batch = toCreate.slice(i, i + CHUNK);
        await Promise.all(
          batch.map((u) =>
            db
              .collection('users')
              .add({ data: { openid: u.openid, nickname: u.nickname, mmr: u.mmr, roles: u.roles, signature: u.signature } })
              .catch(() => null)
          )
        );
      }
      const regs = toAdd.map((u) => ({
        openid: u.openid,
        nickname: u.nickname,
        role: u.role,
        ts: Date.now(),
        mmr: u.mmr,
        roles: u.roles,
        signature: u.signature,
      }));
      const registrations = (t.registrations || []).concat(regs);
      await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
      return ok({
        added: regs.length,
        playerFilled: registrations.filter((r) => r.role === 'player').length,
        playerTotal: need,
        waitlistFilled: registrations.filter((r) => r.role === 'waitlist').length,
        waitLimit,
        auto: true,
      });
    }

    const vcaps = VCAPS.map((c, i) => ({
      openid: 'vcap' + (i + 1),
      nickname: c.nickname,
      mmr: c.mmr,
      roles: c.roles,
      signature: c.signature,
    }));
    const vplys = VNAMES.map((n, i) => ({
      openid: 'vply' + (i + 1),
      nickname: n,
      mmr: 4000 + Math.floor(Math.random() * 5000),
      roles: pickRoles(),
      signature: pick(SIGS),
    }));
    const all = vcaps.concat(vplys);

    const existing = (t.registrations || []).map((r) => r.openid);
    const skip = new Set(existing);
    const toAdd = all.filter((u) => !skip.has(u.openid));
    if (!toAdd.length) return fail('虚拟用户已全部报名过了（如需重新注入，请先删除本场比赛再重建）');

    // 写入 users（仅超管可用，走显式 openid 字段）；并行去重查询 + 分批并行写入，避免超时
    const dups = await Promise.all(toAdd.map((u) => getUser(u.openid)));
    const toCreate = toAdd.filter((u, i) => !dups[i]);
    const CHUNK = 8;
    for (let i = 0; i < toCreate.length; i += CHUNK) {
      const batch = toCreate.slice(i, i + CHUNK);
      await Promise.all(
        batch.map((u) =>
          db
            .collection('users')
            .add({ data: { openid: u.openid, nickname: u.nickname, mmr: u.mmr, roles: u.roles, signature: u.signature } })
            .catch(() => null)
        )
      );
    }
    const regs = toAdd.map((u) => {
      const r = {
        openid: u.openid,
        nickname: u.nickname,
        role: u.openid.indexOf('vcap') === 0 ? 'captain' : 'player',
        ts: Date.now(),
        mmr: u.mmr,
        roles: u.roles,
        signature: u.signature,
      };
      if (r.role === 'captain') r.teamName = '';
      return r;
    });
    const registrations = (t.registrations || []).concat(regs);
    await db.collection('tournaments').doc(t._id).update({ data: { registrations } });
    return ok({ added: regs.length, captainFilled: registrations.filter((r) => r.role === 'captain').length, playerFilled: registrations.filter((r) => r.role === 'player').length });
  },

  /* 比赛详情（按 id；不传 id 时取今天最新创建的一场） */
  async tournament(event) {
    const openid = getOpenId();
    let t = null;
    if (event.id) {
      t = await getTournamentById(event.id);
    } else {
      const todayStart = Number(event.todayStart) || 0;
      const res = await db
        .collection('tournaments')
        .where(todayStart ? { createdAt: _.gte(todayStart) } : {})
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      t = res.data && res.data.length ? res.data[0] : null;
    }
    if (!t) return fail('比赛不存在');
    return ok(await composeTournament(t, openid));
  },
};

/* ---------------- 入口 ---------------- */

exports.main = async (event) => {
  try {
    await ensureCollections();
    const action = event.action || event.type;
    const fn = actions[action];
    if (!fn) return fail('未知操作：' + action);
    return await fn(event);
  } catch (e) {
    console.error('dota2 cloud function error:', e);
    return fail('服务异常：' + (e && e.message ? e.message : '未知错误'));
  }
};
