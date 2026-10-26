const TEST_RANK_TIERS = [21, 25, 32, 43, 54, 61, 65, 72, 75, 80];
const ROLE_ID_OFFSETS = { captain: 0, player: 100, waitlist: 200 };
const ROLE_LABELS = { captain: '队长', player: '队员', waitlist: '替补' };

function stableHash(value) {
  const source = String(value || 'tournament');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function testMember(tournamentId, role, index, now) {
  const seed = stableHash(tournamentId);
  const roleOffset = ROLE_ID_OFFSETS[role];
  const serial = String(index + 1).padStart(2, '0');
  const accountId = 700000000 + ((seed % 1000000) * 200) + roleOffset + index;
  const rating = 2500 + ((seed + roleOffset * 13 + index * 317) % 4500);
  const rankTier = TEST_RANK_TIERS[(seed + roleOffset + index) % TEST_RANK_TIERS.length];
  return {
    openid: 'test-' + seed.toString(36) + '-' + role + '-' + index,
    nickname: '测试' + ROLE_LABELS[role] + serial,
    role,
    ts: now,
    mmr: rating,
    dota2Id: String(accountId),
    dota2RankTier: rankTier,
    dota2RankVerified: true,
    dota2RankVerifiedAt: now,
    dota2LeaderboardRank: null,
    roles: [((seed + index) % 5) + 1],
    signature: '报名流程测试数据',
    ...(role === 'captain' ? { teamName: '', teamIcon: '' } : {}),
  };
}

function buildTestRegistrationAdditions(tournament, now) {
  const source = tournament || {};
  const registrations = Array.isArray(source.registrations) ? source.registrations.slice() : [];
  const teams = Math.max(0, Math.floor(Number(source.N) || 0));
  const playersPerTeam = Math.max(0, Math.floor(Number(source.K) || 0));
  const waitLimit = Math.max(0, Math.floor(Number(source.waitLimit) || 0));
  const captainMode = source.mode !== 'auto';
  const targets = {
    captain: captainMode ? teams : 0,
    player: teams * playersPerTeam,
    waitlist: waitLimit,
  };
  const counts = { captain: 0, player: 0, waitlist: 0 };
  const usedOpenids = new Set();
  registrations.forEach((registration) => {
    if (!registration) return;
    if (Object.prototype.hasOwnProperty.call(counts, registration.role)) counts[registration.role] += 1;
    if (typeof registration.openid === 'string' && registration.openid) usedOpenids.add(registration.openid);
  });

  const additions = [];
  ['captain', 'player', 'waitlist'].forEach((role) => {
    let index = counts[role];
    while (counts[role] < targets[role]) {
      let member = testMember(source._id, role, index, Number(now) || Date.now());
      while (usedOpenids.has(member.openid)) {
        index += 1;
        member = testMember(source._id, role, index, Number(now) || Date.now());
      }
      usedOpenids.add(member.openid);
      additions.push(member);
      counts[role] += 1;
      index += 1;
    }
  });

  return {
    additions,
    counts,
    targets,
  };
}

module.exports = { buildTestRegistrationAdditions };
