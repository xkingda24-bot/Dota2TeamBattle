/**
 * 用户资料与名片动作。从原 index.js 拆出（纯搬移）；
 * saveProfile 新增 UGC 内容安全检测（msgSecCheck）。
 */
const { cloud, db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { DOTA_ID_RE } = require('../constants');
const { isRankVerified } = require('../card-profile');
const { getDotaProfile } = require('../dota-profile');
const { getUser, getCardStylesByOpenids, getUsersByOpenids } = require('../users');
const { DEFAULT_CARD_STYLE, CARD_STYLE_OPTIONS, normalizeCardStyle } = require('../cards');
const { checkUserText } = require('../content-security');
const { buildPlayerStats } = require('../player-stats');

// scene 取值以官方文档为准：1 资料 / 2 评论 / 3 正文 / 4 昵称
const SCENE_PROFILE = 1;

// 生涯统计只需要赛程与队伍相关字段，不拉整个文档（感言、暗号等都不需要）
const PROFILE_TOURNAMENT_FIELDS = {
  _id: true,
  name: true,
  time: true,
  mode: true,
  N: true,
  K: true,
  bracketType: true,
  champion: true,
  teams: true,
  captainOrder: true,
  draft: true,
  matches: true,
  seeding: true,
  standingsOrder: true,
  status: true,
  createdAt: true,
  deletedAt: true,
};

/**
 * 读取某位玩家参与过的赛事。
 * 主路径走 registeredOpenids（报名时由 buildRegistrationSummary 写入的数组）；
 * 尚未回填该字段的旧赛事再补一次嵌套字段查询，失败则忽略，不影响主路径。
 */
async function loadPlayerTournaments(openid) {
  const rows = [];
  const seen = {};
  const push = (list) => {
    (list || []).forEach((tournament) => {
      if (!tournament || !tournament._id || tournament.deletedAt || seen[tournament._id]) return;
      seen[tournament._id] = true;
      rows.push(tournament);
    });
  };
  for (let skip = 0; skip < 300; skip += 100) {
    const res = await db.collection('tournaments')
      .where({ registeredOpenids: openid })
      .field(PROFILE_TOURNAMENT_FIELDS)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(100)
      .get();
    push(res.data);
    if (!res.data || res.data.length < 100) break;
  }
  try {
    const legacy = await db.collection('tournaments')
      .where({ 'registrations.openid': openid })
      .field(PROFILE_TOURNAMENT_FIELDS)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    push(legacy.data);
  } catch (e) {
    /* 旧数据补查失败可忽略：主路径已覆盖正常赛事 */
  }
  return rows;
}

/* 只对外暴露名片与生涯需要的公开字段 */
function publicPlayerProfile(user, openid) {
  const source = user || {};
  return {
    openid,
    nickname: String(source.nickname || ''),
    mmr: source.mmr == null ? null : Number(source.mmr),
    roles: Array.isArray(source.roles) ? source.roles : [],
    signature: String(source.signature || ''),
    cardStyle: normalizeCardStyle(source.cardStyle),
    dota2Id: String(source.dota2Id || ''),
    dota2RankVerified: !!source.dota2RankVerified,
    dota2RankTier: source.dota2RankTier == null ? null : Number(source.dota2RankTier),
    dota2LeaderboardRank: source.dota2LeaderboardRank == null ? null : Number(source.dota2LeaderboardRank),
    dota2RankVerifiedAt: Number(source.dota2RankVerifiedAt || source.dota2VerifiedAt) || null,
    createdAt: Number(source.createdAt) || null,
  };
}

module.exports = {
  /* 查询公开的 OpenDota 资料；缓存与限频都由云函数负责。 */
  async lookupDota(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    try {
      const profile = await getDotaProfile(event.accountId, openid);
      if (!profile.rankLabel || profile.rankTier <= 0 || profile.rankLabel === '未知段位') {
        return fail('未查到段位，请先打完一场排位');
      }
      const verifiedAt = Date.now();
      return ok(Object.assign({}, profile, {
        verifiedAt,
        rankVerifiedAt: verifiedAt,
        dota2RankVerifiedAt: verifiedAt,
      }));
    } catch (e) {
      return fail(e && e.message ? e.message : 'OpenDota 查询失败，请稍后重试');
    }
  },

  /* 完善/更新资料。天梯分由用户自报；Dota 段位只有在 OpenDota 校验后才保存。 */
  async saveProfile(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const nickname = String(event.nickname || '').trim();
    if (!nickname) return fail('昵称不能为空');
    if (nickname.length > 20) return fail('昵称最多 20 个字');
    const me = await getUser(openid);
    const hasDota2Id = Object.prototype.hasOwnProperty.call(event, 'dota2Id');
    const dota2Id = hasDota2Id
      ? String(event.dota2Id == null ? '' : event.dota2Id).trim()
      : String(me && me.dota2Id || '').trim();
    if (dota2Id && !DOTA_ID_RE.test(dota2Id)) return fail('请输入正确的 Dota2 数字 ID（5-12 位）');
    // 天梯分（必填，1-20000）是用户自报数据，与 OpenDota 段位校验无关。
    const mmrRaw = String(event.mmr == null ? '' : event.mmr).trim();
    if (mmrRaw === '') return fail('请填写天梯分');
    const mmr = Number(mmrRaw);
    if (!Number.isInteger(mmr) || mmr < 1 || mmr > 20000) return fail('天梯分需在 1-20000 之间');
    // 常玩位置（必填，1-5 至少选一个）
    let roles = [];
    if (Array.isArray(event.roles)) {
      roles = Array.from(new Set(event.roles.map((v) => Number(v)).filter((v) => v >= 1 && v <= 5))).sort(
        (a, b) => a - b
      );
    }
    if (roles.length === 0) return fail('请至少选择一个常玩位置');
    // 个人签名（选填，不超过 25 个字）
    const signature = String(event.signature || '').trim();
    if (signature.length > 25) return fail('个人签名最多 25 个字');

    // UGC 内容安全检测：昵称与签名会展示给所有用户
    const nicknameCheck = await checkUserText(cloud, openid, SCENE_PROFILE, nickname);
    if (!nicknameCheck.ok) return fail(nicknameCheck.message);
    if (signature) {
      const signatureCheck = await checkUserText(cloud, openid, SCENE_PROFILE, signature);
      if (!signatureCheck.ok) return fail(signatureCheck.message);
    }

    // 更换 Dota ID 时必须先完成 OpenDota 段位校验；清空 ID 则会同时清除段位资料。
    let dotaProfile = null;
    const hasFreshSavedRank = !!(dota2Id && me && me.dota2Id === dota2Id && isRankVerified(me));
    const rankConfirmed = event.dotaRankConfirmed === true &&
      event.dota2RankTier !== null && event.dota2RankTier !== undefined && event.dota2RankTier !== '';
    if (dota2Id && (!me || dota2Id !== String(me.dota2Id || '').trim()) && !rankConfirmed) {
      return fail('更换 Dota 2 ID 前请先完成段位校验');
    }
    if (rankConfirmed && !dota2Id) return fail('请先填写 Dota 2 ID 再进行段位校验');
    if (dota2Id && rankConfirmed) {
      try {
        dotaProfile = await getDotaProfile(dota2Id, openid);
      } catch (e) {
        return fail(e && e.message ? e.message : 'OpenDota 查询失败，请稍后重试');
      }
      if (!dotaProfile.rankTier || dotaProfile.rankLabel === '未知段位') {
        return fail('未查到段位，请先打完一场排位');
      }
      const submittedLeaderboard = event.dota2LeaderboardRank == null || event.dota2LeaderboardRank === ''
        ? null
        : Number(event.dota2LeaderboardRank);
      if (Number(event.dota2RankTier) !== dotaProfile.rankTier || submittedLeaderboard !== dotaProfile.leaderboardRank) {
        return fail('OpenDota 段位信息已变化，请重新校验');
      }
    }

    // 新昵称查重：仅当该昵称属于"别人"时拒绝（自己当前昵称、自己的旧记录不算）
    const dup = await db.collection('users').where({ nickname }).limit(1).get();
    if (dup.data && dup.data.length) {
      const dupRec = dup.data[0];
      const dupOwner = dupRec.openid || dupRec._openid || '';
      const isSelf = me ? dupRec._id === me._id : dupOwner === openid;
      if (!isSelf && dupOwner && dupOwner !== openid) return fail('该昵称已被使用，请换一个');
    }

    const savedRank = dotaProfile
      ? {
          dota2RankVerified: true,
          dota2RankTier: dotaProfile.rankTier,
          dota2RankLabel: dotaProfile.rankLabel,
          dota2LeaderboardRank: dotaProfile.leaderboardRank,
          dota2RankVerifiedAt: Date.now(),
          dota2Nickname: dotaProfile.nickname,
        }
      : hasFreshSavedRank
        ? {
            dota2RankVerified: true,
            dota2RankTier: me.dota2RankTier,
            dota2RankLabel: me.dota2RankLabel,
            dota2LeaderboardRank: me.dota2LeaderboardRank == null ? null : me.dota2LeaderboardRank,
            dota2RankVerifiedAt: me.dota2RankVerifiedAt || me.dota2VerifiedAt,
            dota2Nickname: me.dota2Nickname || '',
          }
        : {
            dota2RankVerified: false,
            dota2RankTier: null,
            dota2RankLabel: '',
            dota2LeaderboardRank: null,
            dota2RankVerifiedAt: null,
            dota2Nickname: '',
          };
    const data = {
      openid,
      nickname,
      mmr,
      roles,
      signature,
      dota2Id,
      ...savedRank,
      // Keep the legacy timestamp field for older clients while the new field
      // is used for the independent 14-day rank verification window.
      dota2VerifiedAt: savedRank.dota2RankVerifiedAt || null,
      cardStyle: normalizeCardStyle(me && me.cardStyle),
      updatedAt: Date.now(),
    };
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

  /* 保存自己的名片装扮；只允许白名单预设，防止任意样式值进入公开页面。 */
  async saveCardStyle(event) {
    const openid = getOpenId();
    const me = await getUser(openid);
    if (!me) return fail('请先设置个人资料');
    const incoming = event.cardStyle || event.style;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return fail('名片样式参数无效');
    const merged = Object.assign({}, me.cardStyle || {}, incoming);
    for (const field of Object.keys(DEFAULT_CARD_STYLE)) {
      if (merged[field] != null && CARD_STYLE_OPTIONS[field].indexOf(merged[field]) < 0) {
        return fail('名片样式包含不支持的选项');
      }
    }
    const cardStyle = normalizeCardStyle(merged);
    // 旧数据可能同时存在 _openid 与显式 openid 记录；同步两类记录，避免样式读取到另一条旧记录。
    const [explicitRes, ownerRes] = await Promise.all([
      db.collection('users').where({ openid }).limit(100).get().catch(() => ({ data: [] })),
      db.collection('users').where({ _openid: openid }).limit(100).get().catch(() => ({ data: [] })),
    ]);
    const records = [];
    const seen = {};
    [me].concat(explicitRes.data || [], ownerRes.data || []).forEach((record) => {
      if (record && record._id && !seen[record._id]) {
        seen[record._id] = true;
        records.push(record);
      }
    });
    await Promise.all(records.map((record) => db.collection('users').doc(record._id).update({ data: { cardStyle, updatedAt: Date.now() } })));
    return ok({ cardStyle });
  },

  /* 批量读取公开样式，用于领奖台或队伍列表等需要一次显示多张名片的页面。 */
  async getCardStyles(event) {
    const openids = Array.isArray(event.openids) ? Array.from(new Set(event.openids.filter(
      (id) => typeof id === 'string' && id.trim() && id.length <= 128
    ))) : [];
    if (openids.length > 100) return fail('一次最多读取 100 位用户的名片样式');
    return ok({ cardStyles: await getCardStylesByOpenids(openids) });
  },

  /**
   * 选手生涯档案（只读、公开）。
   * 不传 openid 即查看自己；他人只能拿到名片字段与比赛统计，拿不到任何管理信息。
   */
  async getPlayerProfile(event) {
    const selfOpenid = getOpenId();
    const target = String((event && event.openid) || selfOpenid || '').trim();
    if (!target) return fail('无法识别要查看的玩家');
    if (target.length > 128) return fail('玩家编号无效');
    const [user, tournaments] = await Promise.all([getUser(target), loadPlayerTournaments(target)]);
    const nameByOpenid = {};
    if (user && user.nickname) nameByOpenid[target] = user.nickname;
    const stats = buildPlayerStats(tournaments, target, { nameByOpenid });
    // 搭档昵称：队伍里常只存 openid，这里补一次批量查询，避免档案页出现一串空白
    const missing = stats.partners
      .map((partner) => partner.openid)
      .filter((id) => id && !nameByOpenid[id]);
    if (missing.length) {
      const profiles = await getUsersByOpenids(missing);
      stats.partners.forEach((partner) => {
        const profile = profiles[partner.openid];
        if (profile && profile.nickname) partner.nickname = String(profile.nickname);
      });
    }
    return ok({
      openid: target,
      isSelf: target === selfOpenid,
      profile: publicPlayerProfile(user, target),
      stats,
    });
  },
};
