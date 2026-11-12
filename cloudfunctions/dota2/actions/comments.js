/**
 * 赛后感言动作。从原 index.js 拆出（纯搬移）；
 * addComment 新增 UGC 内容安全检测（msgSecCheck）。
 */
const { cloud, db } = require('../db');
const { ok, fail, getOpenId } = require('../utils');
const { MAX_COMMENT_LENGTH, MAX_COMMENTS } = require('../constants');
const { getUser } = require('../users');
const { canManageTournament } = require('../permissions');
const { getTournamentById, commentOwner, publicComments, canPostComment } = require('../tournaments');
const { checkUserText } = require('../content-security');

// scene 取值以官方文档为准：1 资料 / 2 评论 / 3 正文 / 4 昵称
const SCENE_COMMENT = 2;

module.exports = {
  /* 读取赛后感言（公开内容；发布权限仍由 addComment 校验） */
  async listComments(event) {
    const openid = getOpenId();
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const comments = publicComments(t, openid);
    const admin = await canManageTournament(t, openid);
    return ok({
      comments,
      canComment: canPostComment(t, openid, admin),
      myComment: comments.find((comment) => comment.isMine) || null,
    });
  },

  /* 发表或更新赛后感言：参赛者和本场比赛管理者各可留一条，最多 100 字。 */
  async addComment(event) {
    const openid = getOpenId();
    if (!openid) return fail('无法识别当前用户');
    const t = await getTournamentById(event.id);
    if (!t) return fail('比赛不存在');
    const admin = await canManageTournament(t, openid);
    if (!canPostComment(t, openid, admin)) return fail('仅比赛结束后的参赛者或本场比赛管理者可以留言');

    if (typeof event.text !== 'string') return fail('内容格式无效');
    const text = event.text.trim();
    if (!text) return fail('内容不能为空');
    if (Array.from(text).length > MAX_COMMENT_LENGTH) return fail('内容最多 100 字');

    // UGC 内容安全检测：感言对所有查看者公开展示
    const textCheck = await checkUserText(cloud, openid, SCENE_COMMENT, text);
    if (!textCheck.ok) return fail(textCheck.message);

    const me = await getUser(openid);
    const registration = (t.registrations || []).find((r) => r && r.openid === openid);
    const teamMember = (t.teams || []).reduce((found, team) => {
      if (found || !team) return found;
      const members = [team.captain].concat(team.players || []);
      const member = members.find((item) => item && typeof item === 'object' && item.openid === openid);
      return member || found;
    }, null);
    const nickname = String((me && me.nickname) || (registration && registration.nickname) || (teamMember && teamMember.nickname) || (admin ? '比赛管理者' : '参赛者'))
      .trim()
      .slice(0, 20) || '用户';
    let saveResult;
    try {
      // 事务读取最新数组，避免两次并发提交为同一用户创建重复留言，
      // 也避免同时发表不同用户的留言时互相覆盖。
      saveResult = await db.runTransaction(async (transaction) => {
        const ref = transaction.collection('tournaments').doc(t._id);
        const fresh = await ref.get();
        const latest = fresh && fresh.data;
        if (!latest) return { error: '比赛不存在' };
        if (!canPostComment(latest, openid, admin)) return { error: '仅比赛结束后的参赛者或本场比赛管理者可以留言' };
        const comments = Array.isArray(latest.comments) ? latest.comments.map((comment) => Object.assign({}, comment)) : [];
        const existingIndex = comments.findIndex((comment) => commentOwner(comment) === openid);
        const now = Date.now();
        if (existingIndex >= 0) {
          comments[existingIndex] = Object.assign({}, comments[existingIndex], {
            openid,
            nickname,
            text,
            updatedAt: now,
          });
        } else {
          if (comments.length >= MAX_COMMENTS) return { error: '留言数量已达上限' };
          comments.push({ openid, nickname, text, createdAt: now, updatedAt: now });
        }
        await ref.update({ data: { comments, updatedAt: now } });
        return { comments };
      });
    } catch (e) {
      console.error('save tournament comment failed:', e);
      return fail('感言保存失败，请稍后重试');
    }
    if (saveResult && saveResult.error) return fail(saveResult.error);
    const visible = publicComments({ comments: saveResult.comments }, openid);
    return ok({
      comments: visible,
      myComment: visible.find((comment) => comment.isMine) || null,
    });
  },
};
