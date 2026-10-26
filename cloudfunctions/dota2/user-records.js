function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function compareUserRecords(a, b) {
  return timestamp(b.updatedAt) - timestamp(a.updatedAt) ||
    timestamp(b.createdAt) - timestamp(a.createdAt) ||
    String(a._id || '').localeCompare(String(b._id || ''));
}

function selectUserRecord(records) {
  return (records || []).filter(Boolean).slice().sort(compareUserRecords)[0] || null;
}

function buildUserMap(openids, ownerRecords, explicitRecords) {
  const ids = new Set((openids || []).filter((id) => typeof id === 'string' && id));
  const owners = new Map();
  const explicit = new Map();
  const add = (map, id, user) => {
    if (!ids.has(id)) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(user);
  };

  (ownerRecords || []).forEach((user) => {
    if (user && typeof user._openid === 'string' && user._openid) add(owners, user._openid, user);
  });
  (explicitRecords || []).forEach((user) => {
    // An owned record's _openid is authoritative. Only use the legacy openid
    // field when the record has no usable owner identity.
    if (user && typeof user.openid === 'string' && user.openid &&
      !(typeof user._openid === 'string' && user._openid)) {
      add(explicit, user.openid, user);
    }
  });

  const result = {};
  ids.forEach((openid) => {
    // Keep the same identity precedence as getUser: an _openid-owned profile
    // wins over legacy records that only carry an explicit openid field.
    const user = selectUserRecord(owners.get(openid)) || selectUserRecord(explicit.get(openid));
    if (user) result[openid] = user;
  });
  return result;
}

module.exports = { compareUserRecords, selectUserRecord, buildUserMap };
