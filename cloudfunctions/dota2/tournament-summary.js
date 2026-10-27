const { TOURNAMENT_SUMMARY_FIELDS } = require('./query-projections');

function summarize(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const registrations = Array.isArray(t.registrations) ? t.registrations : [];
  const cachedCounts = t.registrationCounts || {};
  const legacyCounts = () => {
    const counts = { captain: 0, player: 0, waitlist: 0 };
    registrations.forEach((registration) => {
      if (registration && Object.prototype.hasOwnProperty.call(counts, registration.role)) counts[registration.role] += 1;
    });
    return counts;
  };
  const counts = t.registrationCounts ? cachedCounts : legacyCounts();
  const caps = Number(counts.captain) || 0;
  const players = Number(counts.player) || 0;
  const waitlist = Number(counts.waitlist) || 0;
  return {
    id: t._id,
    name: t.name,
    time: t.time,
    mode,
    N: t.N,
    K: t.K,
    status: t.status,
    captainFilled: caps,
    captainTotal: mode === 'auto' ? 0 : t.N,
    playerFilled: players,
    playerTotal: t.N * t.K,
    waitlistFilled: waitlist,
    waitLimit: t.waitLimit || 0,
    champion: t.champion || null,
    creatorName: t.creatorName || '',
    createdAt: t.createdAt,
    archivedAt: t.archivedAt || null,
    deletedAt: t.deletedAt || null,
    meRegistered: myOpenid
      ? (Array.isArray(t.registeredOpenids)
        ? t.registeredOpenids.indexOf(myOpenid) >= 0
        : registrations.some((r) => r.openid === myOpenid))
      : false,
  };
}

module.exports = { TOURNAMENT_SUMMARY_FIELDS, summarize };
