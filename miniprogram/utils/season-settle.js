/**
 * 赛季积分结算的分批续跑封装。
 *
 * 结算云函数一次最多写 SETTLE_BATCH_SIZE 条流水（避免 3 秒调用上限截断），
 * 返回 done=false 时前端需要再调一次，直到 done=true。
 */
const api = require('./api');

const RETRY_DELAY = 350;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settleUntilDone(tournamentId, options) {
  const opts = options || {};
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const maxCalls = Math.max(1, Number(opts.maxCalls) || 12);
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
        if (calls >= maxCalls) {
          const error = new Error('积分结算还没跑完，稍后可在管理端继续补算');
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
