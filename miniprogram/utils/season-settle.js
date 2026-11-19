/**
 * 赛季积分结算的分批续跑封装。
 *
 * 结算云函数一次最多写 SETTLE_BATCH_SIZE 条流水（避免 3 秒调用上限截断），
 * 返回 done=false 时前端需要再调一次，直到 done=true。
 *
 * 重试上限不是固定值：云函数每批返回 participantCount / appliedEntries，
 * 前端据此算出「剩余人数 ÷ 每批 6 条 + 2 次余量」动态放大上限，
 * 80 人、120 人的比赛也能在归档时一次跑完，不必再手动补算。
 */
const api = require('./api');

const RETRY_DELAY = 350;
const BATCH_SIZE = 6;
const DEFAULT_MAX_CALLS = 12;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settleUntilDone(tournamentId, options) {
  const opts = options || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  let maxCalls = Math.max(1, Number(opts.maxCalls) || DEFAULT_MAX_CALLS);
  const id = String(tournamentId || '');
  if (!id) return Promise.reject(new Error('赛事编号缺失'));
  let calls = 0;

  const attempt = () => {
    calls += 1;
    return api.callFunction('seasonPoints', 'settleTournament', { tournamentId: id })
      .then((result) => {
        const data = result || {};
        if (data.done || data.alreadySettled) return data;
        if (onProgress) onProgress(data);
        // 按实际参赛人数放大重试上限，避免大赛事被固定次数截断
        const total = Number(data.participantCount) || 0;
        const applied = Number(data.appliedEntries) || 0;
        if (total > 0) {
          const remainingBatches = Math.ceil(Math.max(0, total - applied) / BATCH_SIZE);
          maxCalls = Math.max(maxCalls, calls + remainingBatches + 2);
        }
        if (calls >= maxCalls) {
          const error = new Error('积分结算还没跑完，可在历史赛事点「继续结算」补算');
          error.pending = data;
          throw error;
        }
        return delay(RETRY_DELAY).then(attempt);
      }, (error) => {
        // 单次调用超时或网络抖动：进度已写进结算记录，下一次接着写
        if (calls >= maxCalls) throw error;
        return delay(RETRY_DELAY).then(attempt);
      });
  };

  return attempt();
}

module.exports = { settleUntilDone };
