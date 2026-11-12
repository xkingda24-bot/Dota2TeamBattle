/* 生涯档案视图模型：完整生涯页（pages/player）与「我的」页的生涯摘要卡共用，
   保证两处对 stats / 名次 / 搭档的兜底口径一致，不各写一份默认值逻辑。 */
const { formatDateTime } = require('./date-time');
const { formatHonors } = require('./honors');

const RANK_CLASS = { 1: 'gold', 2: 'silver', 3: 'bronze' };

function formatDate(timestamp) {
  const text = formatDateTime(timestamp);
  return text ? text.slice(0, 10) : '';
}

function buildCareerView(result, fallbackOpenid) {
  const profile = (result && result.profile) || {};
  const stats = (result && result.stats) || {};
  const openid = String((result && result.openid) || fallbackOpenid || '');
  const placements = Array.isArray(stats.placements) ? stats.placements : [];
  const partners = Array.isArray(stats.partners) ? stats.partners : [];
  return {
    openid,
    isSelf: !!(result && result.isSelf),
    hasProfile: !!(profile.nickname || profile.mmr),
    profile: Object.assign({}, profile, { openid }),
    navTitle: profile.nickname ? profile.nickname + ' 的生涯' : '生涯档案',
    stats: {
      registered: Number(stats.registered) || 0,
      playedTournaments: Number(stats.playedTournaments) || 0,
      matches: Number(stats.matches) || 0,
      wins: Number(stats.wins) || 0,
      losses: Number(stats.losses) || 0,
      winRate: Number(stats.winRate) || 0,
      championships: Number(stats.championships) || 0,
      runnerUps: Number(stats.runnerUps) || 0,
      thirds: Number(stats.thirds) || 0,
      captainTimes: Number(stats.captainTimes) || 0,
      bestStreak: Number(stats.bestStreak) || 0,
      currentStreak: Number(stats.currentStreak) || 0,
    },
    honorsText: formatHonors(stats),
    placements: placements.map((item, index) => ({
      key: (item.id || 'placement') + '-' + index,
      id: String(item.id || ''),
      name: String(item.name || '未命名赛事'),
      teamName: String(item.teamName || ''),
      dateText: formatDate(item.date),
      label: String(item.label || (item.rank ? '第 ' + item.rank + ' 名' : '名次待核实')),
      rankClass: RANK_CLASS[Number(item.rank)] || '',
      recordText: item.matches ? item.wins + ' 胜 ' + item.losses + ' 负' : '未记录赛果',
      isCaptain: !!item.isCaptain,
    })),
    partners: partners.map((item, index) => ({
      key: (item.openid || 'partner') + '-' + index,
      openid: String(item.openid || ''),
      nickname: String(item.nickname || '队友'),
      matches: Number(item.matches) || 0,
      wins: Number(item.wins) || 0,
      winRate: Number(item.winRate) || 0,
    })),
  };
}

/* 摘要卡只放最近两条战绩与一位最佳搭档，完整列表仍在生涯页。 */
function summarizeCareer(view, options) {
  const opts = options || {};
  const placementCount = Number(opts.placements) || 2;
  const partnerCount = Number(opts.partners) || 1;
  const source = view || {};
  return Object.assign({}, source, {
    placements: (source.placements || []).slice(0, placementCount),
    partners: (source.partners || []).slice(0, partnerCount),
  });
}

module.exports = { buildCareerView, summarizeCareer };
