/**
 * content-security 单测：使用假 cloud 对象模拟 msgSecCheck 的各种返回。
 */
const { checkUserText, isRisky } = require('./content-security');

function makeCloud(v2Behavior, v1Behavior) {
  const calls = [];
  const cloud = {
    openapi: {
      security: {
        async msgSecCheck(params) {
          calls.push(params);
          if (params.version === 2) {
            if (v2Behavior === 'pass') return {};
            if (v2Behavior === 'risky') {
              const e = new Error('invalid signature');
              e.errCode = 87014;
              throw e;
            }
            throw new Error('api not allowed'); // v2 不可用（参数/权限不支持）
          }
          if (v1Behavior === 'pass') return {};
          if (v1Behavior === 'risky') {
            const e = new Error('risky content');
            e.errCode = 87014;
            throw e;
          }
          throw new Error('network error'); // 检测服务异常
        },
      },
    },
  };
  return { cloud, calls };
}

async function test() {
  // 1. 空文本直接放行，不调用检测
  {
    const { cloud, calls } = makeCloud('pass', 'pass');
    const r = await checkUserText(cloud, 'oX', 1, '   ');
    if (!r.ok || calls.length !== 0) throw new Error('empty text should pass without api call');
  }

  // 2. v2 通过
  {
    const { cloud, calls } = makeCloud('pass', 'pass');
    const r = await checkUserText(cloud, 'oX', 2, '正常内容');
    if (!r.ok) throw new Error('v2 pass should be ok');
    if (calls.length !== 1 || calls[0].version !== 2 || calls[0].openid !== 'oX' || calls[0].scene !== 2) {
      throw new Error('v2 params mismatch');
    }
  }

  // 3. v2 命中违规 → 拒绝
  {
    const { cloud } = makeCloud('risky', 'pass');
    const r = await checkUserText(cloud, 'oX', 1, '违规内容');
    if (r.ok || !r.message) throw new Error('v2 risky should be rejected');
  }

  // 4. v2 不可用 → 降级 v1，v1 通过
  {
    const { cloud, calls } = makeCloud('unavailable', 'pass');
    const r = await checkUserText(cloud, 'oX', 1, '正常内容');
    if (!r.ok) throw new Error('v1 fallback pass should be ok');
    if (calls.length !== 2 || calls[1].version !== undefined) throw new Error('v1 fallback params mismatch');
  }

  // 5. v1 也命中违规 → 拒绝
  {
    const { cloud } = makeCloud('unavailable', 'risky');
    const r = await checkUserText(cloud, 'oX', 1, '违规内容');
    if (r.ok) throw new Error('v1 risky should be rejected');
  }

  // 6. 检测服务整体异常 → fail-open 放行
  {
    const { cloud } = makeCloud('unavailable', 'error');
    const r = await checkUserText(cloud, 'oX', 1, '正常内容');
    if (!r.ok) throw new Error('service error should fail open');
  }

  // 7. isRisky 识别 errMsg 中的 87014
  if (!isRisky({ errMsg: 'openapi.security.msgSecCheck:fail 87014 risky content' })) {
    throw new Error('isRisky should match 87014 in errMsg');
  }
  if (isRisky({ errCode: -1, errMsg: 'system error' })) {
    throw new Error('isRisky should not match other errors');
  }

  console.log('content-security tests passed (empty/v2 pass/v2 risky/v1 fallback/v1 risky/fail-open).');
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
