/**
 * 报名分享文案（纯函数）。
 *
 * 转发卡片的标题直接决定别人点不点：写死「XX · 报名」没人知道还缺不缺人，
 * 这里按当前报名进度生成「还差 2 人」这类动态文案，分享出去自带紧迫感。
 * 卡片落地路径仍由页面决定，且不带暗号（转发不等于泄露暗号）。
 */

function buildCapacity(tournament) {
  const t = tournament || {};
  const mode = t.mode === 'auto' ? 'auto' : 'captain';
  const teamCount = Number(t.N) || 0;
  const teamSize = Number(t.K) || 0;
  const captainTotal = mode === 'auto' ? 0 : teamCount;
  const playerTotal = teamCount * teamSize;
  const captainFilled = Number(t.captainFilled) || 0;
  const playerFilled = Number(t.playerFilled) || 0;
  const waitLimit = Number(t.waitLimit) || 0;
  const waitFilled = Number(t.waitlistFilled) || 0;
  return {
    mode,
    teamCount,
    teamSize,
    captainNeed: Math.max(0, captainTotal - captainFilled),
    playerNeed: Math.max(0, playerTotal - playerFilled),
    waitNeed: Math.max(0, waitLimit - waitFilled),
    full: captainTotal <= captainFilled && playerTotal <= playerFilled,
  };
}

/**
 * 转发标题。
 * 报名阶段按缺口给具体数字；已齐就换「来看看阵容」，避免反复刷「报名」却没有信息量。
 */
function buildRegisterShareTitle(tournament) {
  const t = tournament || {};
  const name = String(t.name || '').trim() || '刀塔集结';
  const status = String(t.status || '');
  if (status === 'finished') return name + ' · 已结算，来看最终名次';
  if (status === 'battle') return name + ' · 正在对战，来看赛程';
  if (status === 'draft') return name + ' · 选人中，来看阵容';
  const capacity = buildCapacity(t);
  if (capacity.mode === 'captain' && capacity.captainNeed > 0) {
    return name + ' · 还差 ' + capacity.captainNeed + ' 位队长开车';
  }
  if (capacity.playerNeed > 0) {
    return name + ' · ' + (capacity.teamCount ? capacity.teamCount + ' 队局' : '本场') +
      '还差 ' + capacity.playerNeed + ' 人';
  }
  if (capacity.waitNeed > 0) {
    return name + ' · 人已齐，替补还有 ' + capacity.waitNeed + ' 个位置';
  }
  return name + ' · 人已齐，来看阵容';
}

module.exports = { buildRegisterShareTitle, buildCapacity };
