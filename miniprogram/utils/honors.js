/**
 * 名片上的赛季冠亚季文案。全站（我的名片 / 榜单 / 队伍 / 对阵）共用同一份格式，
 * 保证同一份数据在任何页面渲染出来的字都一模一样。
 * 固定三段、没拿过也写 0（例如「0 冠 0 亚 0 季」），这样每张名片第二排的读法完全一致；
 * 只有赛季数据还没取到时（组件未 ready）整段才不出现。
 */
function formatHonors(honors) {
  const source = normalizeHonors(honors);
  return source.champions + ' 冠 ' + source.runnersUp + ' 亚 ' + source.thirds + ' 季';
}

/** 归一成名片要的三个整数，缺失或非法值当 0，避免各页面各自兜底。 */
function normalizeHonors(honors) {
  const source = honors || {};
  return {
    champions: Number(source.champions) || 0,
    runnersUp: Number(source.runnersUp) || 0,
    thirds: Number(source.thirds) || 0,
  };
}

module.exports = { formatHonors, normalizeHonors };
