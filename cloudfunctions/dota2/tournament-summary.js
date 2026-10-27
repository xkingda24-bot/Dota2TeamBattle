const { TOURNAMENT_SUMMARY_FIELDS } = require('./query-projections');

function summarize(t, myOpenid) {
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const registrations = Array.isArray(t.registrations) ? t.registrations : [];
  const caps = registrations.filter((r) => r.role === 'captain').length;
  const players = registrations.filter((r) => r.role === 'player').length;
  const waitlist = registrations.filter((r) => r.role === 'waitlist').length;
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
    meRegistered: myOpenid ? registrations.some((r) => r.openid === myOpenid) : false,
  };
}

module.exports = { TOURNAMENT_SUMMARY_FIELDS, summarize };
