// Keep CloudBase list queries narrow. Detail pages use the full tournament
// document, while list pages only need these fields for their summaries.
const TOURNAMENT_SUMMARY_FIELDS = {
  _id: true,
  name: true,
  time: true,
  mode: true,
  N: true,
  K: true,
  status: true,
  registrations: true,
  waitLimit: true,
  champion: true,
  creatorName: true,
  createdAt: true,
  archivedAt: true,
  deletedAt: true,
};

// The super-admin table does not render card styling, roles, or signatures.
const ADMIN_USER_LIST_FIELDS = {
  _id: true,
  _openid: true,
  openid: true,
  nickname: true,
  dota2Id: true,
  mmr: true,
  dota2RankVerified: true,
  dota2RankTier: true,
  dota2RankVerifiedAt: true,
  dota2VerifiedAt: true,
  dota2LeaderboardRank: true,
  leaderboardRank: true,
  leaderboard_rank: true,
  updatedAt: true,
  createdAt: true,
};

module.exports = { TOURNAMENT_SUMMARY_FIELDS, ADMIN_USER_LIST_FIELDS };
