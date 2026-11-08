const assert = require('assert');
const { resolveId, resolveStage, buildUrl, requiresSecret } = require('./tournament-entry');

// 编号：id 优先，旧版 _id 兜底，缺失返回空串
assert.strictEqual(resolveId({ id: 't1', _id: 'x' }), 't1');
assert.strictEqual(resolveId({ _id: 'x' }), 'x');
assert.strictEqual(resolveId({ id: '' , _id: 'x' }), 'x');
assert.strictEqual(resolveId({ id: 123 }), '123');
assert.strictEqual(resolveId(null), '');
assert.strictEqual(resolveId({}), '');

// 阶段路由：报名 -> register；选人中按组队模式分流；对战/已结束/已归档 -> bracket
assert.strictEqual(resolveStage({ status: 'registration', mode: 'auto' }), 'register');
assert.strictEqual(resolveStage({ status: 'draft', mode: 'auto' }), 'bracket');
assert.strictEqual(resolveStage({ status: 'draft', mode: 'captain' }), 'draft');
assert.strictEqual(resolveStage({ status: 'battle' }), 'bracket');
assert.strictEqual(resolveStage({ status: 'finished' }), 'bracket');
assert.strictEqual(resolveStage({ status: 'finished', archivedAt: 1762500000000 }), 'bracket');
assert.strictEqual(resolveStage(null), 'bracket');

// 生成 URL：前缀与 id 一致，缺 id 不产出可跳转地址
assert.strictEqual(buildUrl({ id: 't1', status: 'battle' }), '/pages/bracket/bracket?id=t1');
assert.strictEqual(buildUrl({ _id: 't2', status: 'finished' }), '/pages/bracket/bracket?id=t2');
assert.strictEqual(buildUrl({ id: 't3', status: 'draft', mode: 'captain' }), '/pages/draft/draft?id=t3');
assert.strictEqual(buildUrl({ id: 't4', status: 'draft', mode: 'auto' }), '/pages/bracket/bracket?id=t4');
assert.strictEqual(buildUrl({ id: 't5', status: 'registration' }), '/pages/register/register?id=t5');
assert.strictEqual(buildUrl({ status: 'battle' }), '');
assert.strictEqual(buildUrl(null), '');

// 暗号：只有报名阶段、且不是管理者/已报名/本机已验过暗号时才需要
assert.strictEqual(requiresSecret({ status: 'registration' }, false), true);
assert.strictEqual(requiresSecret({ status: 'registration' }, true), false);
assert.strictEqual(requiresSecret({ status: 'registration', canManage: true }, false), false);
assert.strictEqual(requiresSecret({ status: 'registration', meRegistered: true }, false), false);
assert.strictEqual(requiresSecret({ status: 'battle' }, false), false);
assert.strictEqual(requiresSecret({ status: 'finished', archivedAt: 1 }, false), false);
assert.strictEqual(requiresSecret(null, false), false);

console.log('tournament entry routing tests passed.');
