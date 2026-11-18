/**
 * 赛事创建/配置/删除/归档与读取动作。从原 index.js 拆出（纯搬移）；
 * createTournament / updateConfig 新增 UGC 内容安全检测（msgSecCheck）。
 */
const { cloud, db, _ } = require('../db');
const { ok, fail, getOpenId, updateTournamentDoc } = require('../utils');
const { MAX_N, MAX_K } = require('../constants');
const { isAdmin, canDeleteTournament } = require('../permissions');
const { getUser } = require('../users');
const {
  getTournamentById,
  getTournamentVersion,
  getTournamentRegistrationSnapshot,
  decorateRegistrationSnapshot,
  requireTournamentManager,
  composeTournament,
  normalizeBracketType,
} = require('../tournaments');
const { mutateTournament, buildRegistrationSummary, isTransactionConflict } = require('../tournament-transaction');
const { chinaDayRange, createQuotaId, effectiveDailyCount, createDailyLimit } = require('../daily-quota');
const { TEAM_LOGO_PRESETS, TEAM_LOGO_IDS } = require('../team-logos');
const { checkUserText } = require('../content-security');

// scene 取值以官方文档为准：1 资料 / 2 评论 / 3 正文 / 4 昵称
const SCENE_CONTENT = 3;

module.exports = {
  /* 创建比赛（普通管理员或超级管理员）：每日最多 20 场，报名需暗号 */
  async createTournament(event) {
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
    if (!openid) return fail('无法识别当前用户');
    const adminFlag = await isAdmin(openid);
    if (!adminFlag) return fail('只有普通管理员或超级管理员可以创建比赛');
    const createLimit = createDailyLimit(adminFlag);

    // UGC 内容安全检测：比赛名称会公开展示，暗号对报名者展示
    const nameCheck = await checkUserText(cloud, openid, SCENE_CONTENT, name);
    if (!nameCheck.ok) return fail(nameCheck.message);
    const secretCheck = await checkUserText(cloud, openid, SCENE_CONTENT, secret);
    if (!secretCheck.ok) return fail(secretCheck.message);

    const me = await getUser(openid);
    const now = Date.now();
    const range = chinaDayRange(now);
    const quotaId = createQuotaId(openid, range.dayKey);
    const tournamentData = {
      name,
      time,
      secret,
      mode,
      N,
      K,
      waitLimit: Math.round(waitLimit),
      status: 'registration',
      registrations: [],
      ...buildRegistrationSummary([]),
      captainOrder: [],
      draft: null,
      teams: [],
      seeding: null,
      matches: [],
      champion: null,
      comments: [],
      createdAt: now,
      updatedAt: now,
      createdBy: openid,
      creatorName: me ? me.nickname : '',
    };
    let result = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        result = await db.runTransaction(async (transaction) => {
        const quotaRef = transaction.collection('config').doc(quotaId);
        const quotaResult = await transaction.collection('config').where({ _id: quotaId }).limit(1).get();
        const quota = quotaResult && quotaResult.data && quotaResult.data.length ? quotaResult.data[0] : null;
        const existing = await transaction.collection('tournaments')
          .where({ createdBy: openid, createdAt: _.gte(range.start).and(_.lt(range.end)) })
          .limit(3)
          .get();
        const existingCount = (existing && existing.data || []).length;
        const used = effectiveDailyCount(quota && quota.count, existingCount);
        if (used >= createLimit) return { error: '每位管理员每天最多创建 ' + createLimit + ' 场比赛' };
        const tournament = await transaction.collection('tournaments').add({ data: tournamentData });
        const quotaData = {
          key: 'createQuota',
          openid,
          dayKey: range.dayKey,
          count: used + 1,
          updatedAt: now,
        };
        if (quota && quota._id) {
          await quotaRef.update({ data: quotaData });
        } else {
          await quotaRef.set({ data: Object.assign({ createdAt: now }, quotaData) });
        }
        return { id: tournament._id, count: used + 1 };
        });
        break;
      } catch (e) {
        if (isTransactionConflict(e) && attempt < 5) continue;
        console.error('create tournament failed:', e);
        return fail('创建比赛失败，请稍后重试');
      }
    }
    if (result && result.error) return fail(result.error);
    return ok({
      id: result.id,
      todayCreateCount: result.count,
      todayCreateRemaining: Math.max(0, createLimit - result.count),
      todayCreateLimit: createLimit,
      dailyLimit: createLimit,
    });
  },

  /* 比赛创建者或管理员：修改报名阶段的比赛配置 */
  async updateConfig(event) {
    const managed = await requireTournamentManager(event);
    if (managed.error) return fail(managed.error);
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

    // UGC 内容安全检测：比赛名称与暗号
    const nameCheck = await checkUserText(cloud, managed.openid, SCENE_CONTENT, name);
    if (!nameCheck.ok) return fail(nameCheck.message);
    const secretCheck = await checkUserText(cloud, managed.openid, SCENE_CONTENT, secret);
    if (!secretCheck.ok) return fail(secretCheck.message);

    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以修改配置' };
      const registrations = Array.isArray(t.registrations) ? t.registrations : [];
      const captains = registrations.filter((r) => r.role === 'captain').length;
      const players = registrations.filter((r) => r.role === 'player').length;
      const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
      if (mode === 'auto') {
        if (captains > 0) return { error: '已有队长报名，不能切换为系统分组模式（请先移除队长报名）' };
        if (N * K < players) return { error: '队员名额不能小于已报名人数（当前已报 ' + players + ' 人）' };
      } else {
        if (N < captains) return { error: '已有 ' + captains + ' 位队长报名，队长数不能小于 ' + captains };
        if (N * K < players) return { error: '队员名额不能小于已报名人数（当前已报 ' + players + ' 人）' };
      }
      if (waitLimit < waitlist) return { error: '替补名额不能小于已报名替补人数（当前 ' + waitlist + ' 人）' };
      return {
        data: { name, time, secret, mode, N, K, waitLimit: Math.round(waitLimit) },
        result: {},
      };
    });
    return result.error ? fail(result.error) : ok({});
  },

  /* 报名暗号校验 */
  async checkSecret(event) {
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    return ok({ correct: String(event.secret || '') === String(t.secret || '') });
  },

  /* 删除比赛（创建者或超管；普通管理员不可删除他人比赛）：永久删除。 */
  async deleteTournament(event) {
    const openid = getOpenId();
    const tournament = await getTournamentById(event && event.id, true);
    if (!tournament) return fail('比赛不存在');
    if (!(await canDeleteTournament(tournament, openid))) {
      return fail('只有比赛创建者或最高管理员可以删除比赛');
    }
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const result = await db.runTransaction(async (transaction) => {
          const tournamentRef = transaction.collection('tournaments').doc(tournament._id);
          const latestResult = await tournamentRef.get();
          const latest = latestResult && latestResult.data;
          if (!latest) return { error: '比赛不存在' };
          if (!(await canDeleteTournament(latest, openid))) {
            return { error: '只有比赛创建者或最高管理员可以删除比赛' };
          }

          // Keep today's quota after a permanent delete. This also accounts for
          // same-day matches that existed before quota tracking was introduced.
          const ownerOpenid = latest.createdBy;
          const range = chinaDayRange(Date.now());
          const createdAt = Number(latest.createdAt) || 0;
          if (ownerOpenid && createdAt >= range.start && createdAt < range.end) {
            const quotaId = createQuotaId(ownerOpenid, range.dayKey);
            const quotaRef = transaction.collection('config').doc(quotaId);
            let quota = null;
            try {
              const quotaResult = await quotaRef.get();
              quota = quotaResult && quotaResult.data;
            } catch (e) {
              quota = null;
            }
            const existing = await transaction.collection('tournaments')
              .where({ createdBy: ownerOpenid, createdAt: _.gte(range.start).and(_.lt(range.end)) })
              .limit(3)
              .get();
            const used = effectiveDailyCount(quota && quota.count, (existing && existing.data || []).length);
            const quotaData = {
              key: 'createQuota',
              openid: ownerOpenid,
              dayKey: range.dayKey,
              count: used,
              updatedAt: Date.now(),
            };
            if (quota && quota._id) {
              await quotaRef.update({ data: quotaData });
            } else {
              await quotaRef.set({ data: Object.assign({ createdAt: Date.now() }, quotaData) });
            }
          }
          await tournamentRef.remove();
          return { deleted: true };
        });
        return result && result.error ? fail(result.error) : ok(true);
      } catch (e) {
        if (isTransactionConflict(e) && attempt < 5) continue;
        throw e;
      }
    }
    return ok(true);
  },

  /* 结束并归档（比赛创建者或最高管理员；普通管理员不可归档） */
  async finishTournament(event) {
    const openid = getOpenId();
    const tournament = await getTournamentById(event && event.id, false);
    if (!tournament) return fail('比赛不存在');
    if (!(await canDeleteTournament(tournament, openid))) {
      return fail('只有比赛创建者或最高管理员可以结束并归档比赛');
    }
    const t = tournament;
    if (t.archivedAt) return fail('比赛已归档');
    if (!t.champion) return fail('比赛还未结束（未产生冠军），不能归档');
    // 单败排位赛 / 8 队挑选赛：名次赛（含三四名决赛）没打完就归档，结算时会因名次不完整被拒绝，这里提前拦住
    if ((normalizeBracketType(t.bracketType) === 'singleRank' || normalizeBracketType(t.bracketType) === 'pick8') &&
      (t.matches || []).some((m) => m.status !== 'done')) {
      return fail('还有名次赛没有打完，不能归档');
    }
    await updateTournamentDoc(t._id, {
      data: { status: 'finished', archivedAt: Date.now() },
    });
    return ok(true);
  },

  /* 固定的内置队标列表：只读，不再由超管维护。 */
  async teamLogoList() {
    return ok({
      logos: TEAM_LOGO_PRESETS,
      presets: TEAM_LOGO_PRESETS,
      icons: TEAM_LOGO_IDS,
    });
  },

  /* 比赛变化轮询：只返回小型版本信息，不组装完整名册和名片。 */
  async tournamentVersion(event) {
    const version = await getTournamentVersion(event.id);
    if (!version) return fail('比赛不存在');
    return ok(version);
  },

  /* 报名页变化轮询：只读取报名名单与名额统计，不装配赛程、评论和卡片资料。 */
  async tournamentRegistrationSnapshot(event) {
    const snapshot = await getTournamentRegistrationSnapshot(event.id, getOpenId());
    if (!snapshot) return fail('比赛不存在');
    return ok(snapshot);
  },

  /* 报名页首屏数据：只返回赛事基础信息、报名名单和本场比赛管理权限。 */
  async registrationDetail(event) {
    const openid = getOpenId();
    const snapshot = await getTournamentRegistrationSnapshot(event.id, openid).then(decorateRegistrationSnapshot);
    if (!snapshot) return fail('比赛不存在');
    return ok(Object.assign({}, snapshot, {
      settlementReady: snapshot.status === 'finished' && !!snapshot.champion,
    }));
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
