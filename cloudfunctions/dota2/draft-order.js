/**
 * 队长选人顺序：有效天梯分从低到高；同分保持报名顺序；未填写/无效天梯分排最后。
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

module.exports = { sortCaptainsByMmr };
