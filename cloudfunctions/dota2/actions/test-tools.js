/**
 * 测试数据注入动作（仅最高管理员，用于自测完整流程）。从原 index.js 拆出（纯搬移）。
 * 注意：生产环境建议配合环境变量开关使用（见项目档案待办）。
 */
const { db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { isSuper } = require('../permissions');
const { getUser } = require('../users');
const { getTournamentById } = require('../tournaments');
const { buildTestRegistrationAdditions } = require('../test-registration');
const { mutateTournament } = require('../tournament-transaction');

module.exports = {
  /* 最高管理员：仅补足当前报名缺口，用于验证完整报名与选人流程。 */
  async fillTestRegistrations(event) {
    const openid = getOpenId();
    if (!(await isSuper(openid))) return fail('只有最高管理员可以补充测试报名数据');
    const result = await mutateTournament(db, event.id, (t) => {
      if (t.status !== 'registration') return { error: '只有报名阶段可以补充测试数据' };
      const additions = buildTestRegistrationAdditions(t, Date.now());
      if (!additions.additions.length) {
        return { result: { added: 0, counts: additions.counts, targets: additions.targets } };
      }
      return {
        data: { registrations: (t.registrations || []).concat(additions.additions) },
        result: { added: additions.additions.length, counts: additions.counts, targets: additions.targets },
      };
    });
    return result.error ? fail(result.error) : ok(result.result);
  },

  /* 生成虚拟测试用户并报名（仅超管；用于自测完整流程） */
  async seedTest(event) {
    if (!(await isSuper(getOpenId()))) return fail('仅最高管理员可生成测试数据');
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
      const commit = await mutateTournament(db, t._id, (current) => {
        if (current.status !== 'registration') return { error: '当前不在报名阶段（测试数据只能在报名阶段注入）' };
        if (current.mode !== 'auto') return { error: '比赛模式已变化，请刷新后重试' };
        const existingIds = new Set((current.registrations || []).map((registration) => registration.openid));
        const currentNeed = current.N * current.K;
        const currentWaitLimit = current.waitLimit || 0;
        let playerSlots = Math.max(0, currentNeed - (current.registrations || []).filter((registration) => registration.role === 'player').length);
        let waitSlots = Math.max(0, currentWaitLimit - (current.registrations || []).filter((registration) => registration.role === 'waitlist').length);
        const additions = toAdd.filter((user) => {
          if (existingIds.has(user.openid)) return false;
          if (user.role === 'player' && playerSlots > 0) {
            playerSlots -= 1;
            return true;
          }
          if (user.role === 'waitlist' && waitSlots > 0) {
            waitSlots -= 1;
            return true;
          }
          return false;
        });
        if (!additions.length) return { error: '当前比赛没有可注入的测试名额' };
        const regs = additions.map((u) => ({
          openid: u.openid,
          nickname: u.nickname,
          role: u.role,
          ts: Date.now(),
          mmr: u.mmr,
          roles: u.roles,
          signature: u.signature,
        }));
        const registrations = (current.registrations || []).concat(regs);
        return {
          data: { registrations },
          result: {
            added: regs.length,
            playerFilled: registrations.filter((r) => r.role === 'player').length,
            playerTotal: currentNeed,
            waitlistFilled: registrations.filter((r) => r.role === 'waitlist').length,
            waitLimit: currentWaitLimit,
            auto: true,
          },
        };
      });
      return commit.error ? fail(commit.error) : ok(commit.result);
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
    const commit = await mutateTournament(db, t._id, (current) => {
      if (current.status !== 'registration') return { error: '当前不在报名阶段（测试数据只能在报名阶段注入）' };
      if (current.mode === 'auto') return { error: '比赛模式已变化，请刷新后重试' };
      const existingIds = new Set((current.registrations || []).map((registration) => registration.openid));
      let captainSlots = Math.max(0, current.N - (current.registrations || []).filter((registration) => registration.role === 'captain').length);
      let playerSlots = Math.max(0, current.N * current.K - (current.registrations || []).filter((registration) => registration.role === 'player').length);
      let waitSlots = Math.max(0, (current.waitLimit || 0) - (current.registrations || []).filter((registration) => registration.role === 'waitlist').length);
      const additions = toAdd.filter((user) => {
        if (existingIds.has(user.openid)) return false;
        const role = user.openid.indexOf('vcap') === 0 ? 'captain' : 'player';
        if (role === 'captain' && captainSlots > 0) {
          captainSlots -= 1;
          return true;
        }
        if (role === 'player' && playerSlots > 0) {
          playerSlots -= 1;
          return true;
        }
        if (role === 'waitlist' && waitSlots > 0) {
          waitSlots -= 1;
          return true;
        }
        return false;
      });
      if (!additions.length) return { error: '当前比赛没有可注入的测试名额' };
      const regs = additions.map((u) => {
        const registration = {
          openid: u.openid,
          nickname: u.nickname,
          role: u.openid.indexOf('vcap') === 0 ? 'captain' : 'player',
          ts: Date.now(),
          mmr: u.mmr,
          roles: u.roles,
          signature: u.signature,
        };
        if (registration.role === 'captain') {
          registration.teamName = '';
          registration.teamIcon = '';
        }
        return registration;
      });
      const registrations = (current.registrations || []).concat(regs);
      return {
        data: { registrations },
        result: {
          added: regs.length,
          captainFilled: registrations.filter((r) => r.role === 'captain').length,
          playerFilled: registrations.filter((r) => r.role === 'player').length,
        },
      };
    });
    return commit.error ? fail(commit.error) : ok(commit.result);
  },
};
