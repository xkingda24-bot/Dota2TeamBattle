function hasMissingPublicData(source) {
  const player = source || {};
  const snapshot = player.dota2LookupSnapshot || player.dota2Lookup;
  const data = snapshot || ((player.recentStats || Array.isArray(player.commonHeroes)) ? player : null);
  if (!data) return player.dota2PublicDataMissing === true;
  const total = Number(data.recentStats && data.recentStats.total);
  const commonHeroes = Array.isArray(data.commonHeroes) ? data.commonHeroes : [];
  return (!Number.isFinite(total) || total <= 0) && commonHeroes.length === 0;
}

module.exports = { hasMissingPublicData };
