const { formatDateTime } = require('./date-time');

function remainingText(endAt, permanent, serverTime) {
  if (permanent) return '不会自动解除';
  const remaining = Number(endAt) - Number(serverTime);
  if (!Number.isFinite(remaining) || remaining <= 0) return '已到期';
  if (remaining >= 24 * 60 * 60 * 1000) {
    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
    return '剩余 ' + days + ' 天';
  }
  const hours = Math.max(1, Math.ceil(remaining / (60 * 60 * 1000)));
  return '剩余 ' + hours + ' 小时';
}

function decorateBan(item, serverTime) {
  const permanent = item.permanent === true || item.duration === 'permanent';
  return Object.assign({}, item, {
    dotaIdText: item.dota2Id || '未填写 ID',
    statusText: permanent ? '永久禁赛' : '禁赛中',
    endText: permanent ? '永久有效' : '禁赛至 ' + formatDateTime(item.endAt),
    remainingText: remainingText(item.endAt, permanent, serverTime),
  });
}

module.exports = { remainingText, decorateBan };
