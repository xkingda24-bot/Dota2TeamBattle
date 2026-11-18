/* 创建比赛权限：管理员默认可创建，普通用户需由超管单独开通。 */
function hasTournamentCreateAccess(user, isAdminFlag) {
  return isAdminFlag === true || !!(user && user.canCreateTournament === true);
}

module.exports = { hasTournamentCreateAccess };
