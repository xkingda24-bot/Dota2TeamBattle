function hasSmurfWarning(source) {
  const player = source || {};
  const snapshot = player.dota2LookupSnapshot || player.dota2Lookup;
  const recent = snapshot && snapshot.recentStats ? snapshot.recentStats : player.recentStats;
  if (!recent) return player.dota2SmurfWarning === true;
  const total = Number(recent.total);
  const wins = Number(recent.wins);
  const kda = Number(recent.kda);
  if (!Number.isFinite(total) || total <= 0) return false;
  const highWinRate = Number.isFinite(wins) && wins >= 0 && wins <= total && wins / total >= 0.8;
  const highKda = Number.isFinite(kda) && kda >= 5;
  return highWinRate || highKda;
}

function shouldShowSmurfWarning(source, viewerOpenid, rankVerified) {
  const player = source || {};
  const viewer = String(viewerOpenid || '');
  const isSelf = player.isSelf === true || player.isMine === true ||
    (!!viewer && String(player.openid || '') === viewer);
  return rankVerified === true && !isSelf && hasSmurfWarning(player);
}

module.exports = { hasSmurfWarning, shouldShowSmurfWarning };
