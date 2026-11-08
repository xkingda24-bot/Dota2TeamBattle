/**
 * 云函数调用封装（身份由微信 OpenID 确认，无需密码会话）
 */
function call(action, data) {
  const payload = Object.assign({}, data || {}, { action });
  return wx.cloud
    .callFunction({ name: 'dota2', data: payload })
    .then((res) => {
      const r = res.result || {};
      if (!r.success) {
        const err = new Error(r.message || '操作失败');
        err.biz = true;
        throw err;
      }
      return r.data;
    })
    .catch((e) => {
      if (e && e.biz) throw e;
      const err = new Error('云函数调用失败，请确认已配置云环境并在开发者工具中部署「dota2」云函数');
      err.cloud = true;
      throw err;
    });
}

/**
 * Call an explicitly named cloud function. Existing `call()` remains pinned to
 * dota2 so adding optional services cannot reroute legacy requests.
 */
function callFunction(name, action, data) {
  const functionName = String(name || '').trim();
  if (!functionName) return Promise.reject(new Error('云函数名称缺失'));
  const payload = Object.assign({}, data || {}, { action });
  return wx.cloud
    .callFunction({ name: functionName, data: payload })
    .then((res) => {
      const r = res.result || {};
      if (!r.success) {
        const err = new Error(r.message || '操作失败');
        err.biz = true;
        throw err;
      }
      return r.data;
    })
    .catch((e) => {
      if (e && e.biz) throw e;
      const err = new Error('云函数调用失败，请确认已部署「' + functionName + '」云函数');
      err.cloud = true;
      throw err;
    });
}

module.exports = { call, callFunction };
