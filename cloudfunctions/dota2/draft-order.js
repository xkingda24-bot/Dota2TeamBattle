/**
 * 队长选人顺序：
 * - mmr（默认）：有效天梯分从低到高；同分保持报名顺序；未填写/无效天梯分排最后。
 * - random：随机打乱队长顺序（开始/重置选人时由比赛创建者或管理员选择）。
 */
function validMmr(captain) {
  const value = captain && captain.mmr;
  if (value === null || value === undefined || value === '') return null;
  const mmr = Number(value);
  return Number.isFinite(mmr) && mmr > 0 ? mmr : null;
}

function sortCaptainsByMmr(captains) {
  return (Array.isArray(captains) ? captains : [])
    .map((captain, index) => ({ captain, index, mmr: validMmr(captain) }))
    .sort((a, b) => {
      if (a.mmr === null && b.mmr === null) return a.index - b.index;
      if (a.mmr === null) return 1;
      if (b.mmr === null) return -1;
      return a.mmr - b.mmr || a.index - b.index;
    })
    .map((item) => item.captain);
}

function shuffleCaptains(captains) {
  const list = (Array.isArray(captains) ? captains : []).slice();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = list[i];
    list[i] = list[j];
    list[j] = temp;
  }
  return list;
}

function orderCaptains(captains, mode) {
  return mode === 'random' ? shuffleCaptains(captains) : sortCaptainsByMmr(captains);
}

module.exports = { sortCaptainsByMmr, orderCaptains };
