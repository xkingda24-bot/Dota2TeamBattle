/**
 * UGC 文本内容安全检测（security.msgSecCheck）。
 *
 * 用于昵称、签名、队名、比赛名称/暗号、赛后感言等用户可自由输入的文本，
 * 满足微信小程序对 UGC 内容的安全检测要求。
 *
 * 策略：
 *  - 优先调用 msgSecCheck v2（带 openid + scene，命中更准）；SDK/权限不支持 v2 参数时降级 v1；
 *  - 命中违规（errCode 87014）→ 拒绝写入；
 *  - 检测服务本身异常 → 记录日志后放行（fail-open），避免检测服务抖动阻断正常业务。
 *    部署后请确认云函数 config.json 已声明 security.msgSecCheck 权限，否则检测会被跳过。
 *
 * ⚠️ v2 参数（version/scene）与 scene 取值以微信官方文档为准：
 *    https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html
 */
const RISKY_MESSAGE = '内容包含违规信息，请修改后重试';

function isRisky(e) {
  if (!e) return false;
  if (Number(e.errCode) === 87014) return true;
  return /87014|risky/i.test(String(e.errMsg || ''));
}

/**
 * 检测一段用户文本。
 * @param {object} cloud wx-server-sdk 的 cloud 实例
 * @param {string} openid 用户 openid（v2 检测需要）
 * @param {number} scene 场景值（1 资料 / 2 评论 / 3 正文 / 4 昵称，以官方文档为准）
 * @param {string} text 待检测文本；空串直接放行
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function checkUserText(cloud, openid, scene, text) {
  const content = String(text == null ? '' : text).trim();
  if (!content) return { ok: true };
  try {
    // v2：带 openid 与场景，检测准确率更高
    await cloud.openapi.security.msgSecCheck({ content, openid, scene, version: 2 });
    return { ok: true };
  } catch (e) {
    if (isRisky(e)) return { ok: false, message: RISKY_MESSAGE };
    // v2 不可用（SDK 版本/参数不支持等）：降级 v1
    try {
      await cloud.openapi.security.msgSecCheck({ content });
      return { ok: true };
    } catch (e2) {
      if (isRisky(e2)) return { ok: false, message: RISKY_MESSAGE };
      // 检测服务异常（未配置权限/网络问题等）：记录并放行
      console.error('msgSecCheck unavailable:', e2 && (e2.errMsg || e2.message));
      return { ok: true };
    }
  }
}

module.exports = { checkUserText, isRisky };
