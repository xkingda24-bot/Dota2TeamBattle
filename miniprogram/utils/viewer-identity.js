function rememberViewerOpenid(data) {
  const source = data || {};
  let openid = '';
  if (typeof source.myOpenid === 'string') openid = source.myOpenid;
  else if (source.user && typeof source.user.openid === 'string') openid = source.user.openid;
  else if (source.isSelf === true && typeof source.openid === 'string') openid = source.openid;
  openid = openid.trim();
  if (!openid) return;
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.viewerOpenid = openid;
  } catch (e) {
    // App 尚未就绪时不阻断业务数据加载。
  }
}

function currentViewerOpenid() {
  try {
    const app = getApp();
    return String(app && app.globalData && app.globalData.viewerOpenid || '');
  } catch (e) {
    return '';
  }
}

module.exports = { rememberViewerOpenid, currentViewerOpenid };
