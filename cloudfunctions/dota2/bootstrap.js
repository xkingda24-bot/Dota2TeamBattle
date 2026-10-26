function canInitializeSuperAdmin(openid, currentSuperAdmin, configuredOpenid) {
  const allowedOpenid = String(configuredOpenid || '').trim();
  return !currentSuperAdmin && !!allowedOpenid && openid === allowedOpenid;
}

module.exports = { canInitializeSuperAdmin };
