const assert = require('assert');
const { buildRegistration, syncRegistrationProfiles, skipRegistrationSecret } = require('./registration');

const member = { nickname: '队员甲', mmr: 4200, roles: [1, 3], signature: '冲分' };
const base = {
  status: 'registration',
  mode: 'captain',
  secret: 'letmein',
  N: 2,
  K: 2,
  waitLimit: 1,
  registrations: [],
};
const noDotaFields = { dota2Id: '', dota2RankVerified: false };

let created = buildRegistration(base, 'u1', member, 'captain', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'captain');
assert.strictEqual(created.registration.teamName, '');
assert.strictEqual(created.result.auto, false);
assert.strictEqual(created.result.captainFilled, 1);
assert.strictEqual(created.result.registration, created.registration);

created = buildRegistration(base, 'u1', member, 'player', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'player');

// 报名成功后会立即把 result.registration 插入页面名单，必须在首次渲染前带上名片样式。
const styledCard = { background: 'moon', border: 'frost', font: 'mono', color: 'arcane', animation: 'omnislash' };
created = buildRegistration(base, 'u-style', Object.assign({}, member, { cardStyle: styledCard }), 'player', 'letmein', noDotaFields, 123);
assert.deepStrictEqual(created.registration.cardStyle, styledCard);
assert.deepStrictEqual(created.result.registration.cardStyle, styledCard);
assert.deepStrictEqual(created.registrations[0].cardStyle, styledCard);

const fullPlayers = Object.assign({}, base, {
  registrations: [
    { openid: 'p1', role: 'player' },
    { openid: 'p2', role: 'player' },
    { openid: 'p3', role: 'player' },
    { openid: 'p4', role: 'player' },
  ],
});
created = buildRegistration(fullPlayers, 'u3', member, 'player', 'letmein', noDotaFields, 123);
assert.strictEqual(created.registration.role, 'waitlist');
assert.strictEqual(created.result.auto, true);
assert.strictEqual(created.result.waitlistFilled, 1);

assert.strictEqual(
  buildRegistration(Object.assign({}, fullPlayers, { waitLimit: 0 }), 'u3', member, 'player', 'letmein', noDotaFields, 123).error,
  '队员名额已满'
);
assert.strictEqual(
  buildRegistration(Object.assign({}, base, { registrations: [{ openid: 'u1', role: 'player' }] }), 'u1', member, 'player', 'letmein', noDotaFields, 123).error,
  '你已经报名过了'
);
// 分组阶段不再允许首发报名，但改成更明确的提示（替补仍可报名，见文件末尾用例）
assert.strictEqual(buildRegistration(Object.assign({}, base, { status: 'draft' }), 'u1', member, 'player', 'letmein', noDotaFields, 123).error, '分组进行中，只能报名替补');
assert.strictEqual(buildRegistration(base, 'u1', member, 'player', 'wrong', noDotaFields, 123).error, '报名暗号错误');

/* 普通管理员 / 比赛创建者报名免暗号（skipSecret） */
created = buildRegistration(base, 'uAdmin', member, 'player', 'wrong', noDotaFields, 123, true);
assert.strictEqual(created.registration.role, 'player');
assert.strictEqual(created.error, undefined);
assert.strictEqual(buildRegistration(base, 'u1', member, 'player', 'wrong', noDotaFields, 123, false).error, '报名暗号错误');
assert.strictEqual(buildRegistration(base, 'u1', member, 'player', 'wrong', noDotaFields, 123, 0).error, '报名暗号错误');

/* 申请免暗号的身份判定：管理员或本场创建者（报名页对 canManage 不显示暗号输入框） */
const ownRoom = Object.assign({}, base, { createdBy: 'creator' });
assert.strictEqual(skipRegistrationSecret(ownRoom, 'creator', false), true, '创建者应免暗号');
assert.strictEqual(skipRegistrationSecret(ownRoom, 'other', false), false, '非创建者仍需暗号');
assert.strictEqual(skipRegistrationSecret(base, 'creator', true), true, '管理员免暗号');
assert.strictEqual(skipRegistrationSecret(Object.assign({}, base, { createdBy: '' }), 'creator', false), false, '无创建者字段时不免暗号');
assert.strictEqual(skipRegistrationSecret(null, 'creator', false), false, '比赛为空时不误放行');

/* 组合到报名路径：创建者带空暗号也能报名；非创建者带空暗号仍报暗号错误 */
const skipForCreator = skipRegistrationSecret(ownRoom, 'creator', false);
created = buildRegistration(ownRoom, 'creator', member, 'player', '', noDotaFields, 123, skipForCreator);
assert.strictEqual(created.error, undefined, '创建者空暗号应报名成功');
assert.strictEqual(created.registration.role, 'player');
assert.strictEqual(created.registrations.length, 1);
const skipForOther = skipRegistrationSecret(ownRoom, 'other', false);
assert.strictEqual(
  buildRegistration(ownRoom, 'other', member, 'player', '', noDotaFields, 123, skipForOther).error,
  '报名暗号错误'
);

const synced = syncRegistrationProfiles([
  { openid: 'u1', role: 'player', nickname: '旧昵称', mmr: 4200, roles: [1], signature: '旧签名', ts: 123 },
  { openid: 'u2', role: 'waitlist', nickname: '替补', mmr: 3000, roles: [5], signature: '' },
], {
  u1: { nickname: '新昵称', mmr: 9000, roles: [2, 3], signature: '新签名', dota2Id: '' },
});
assert.strictEqual(synced.changed, true);
assert.strictEqual(synced.registrations[0].nickname, '新昵称');
assert.strictEqual(synced.registrations[0].mmr, 9000);
assert.deepStrictEqual(synced.registrations[0].roles, [2, 3]);
assert.strictEqual(synced.registrations[0].signature, '新签名');
assert.strictEqual(synced.registrations[0].ts, 123);
assert.strictEqual(synced.registrations[1].mmr, 3000);

// 分组流程（status=draft）：替补席位未满仍可报名替补；首发/队长不允许再挤进来
const draftOpen = Object.assign({}, base, { status: 'draft', registrations: [{ openid: 'p1', role: 'player' }] });
let draftResult = buildRegistration(draftOpen, 'late1', member, 'waitlist', 'letmein', noDotaFields, 123);
assert.strictEqual(draftResult.registration.role, 'waitlist', '分组阶段替补未满时可以报名替补');
assert.strictEqual(draftResult.result.waitlistFilled, 1);

assert.strictEqual(
  buildRegistration(draftOpen, 'late2', member, 'player', 'letmein', noDotaFields, 123).error,
  '分组进行中，只能报名替补',
  '分组阶段不能按首发报名'
);
assert.strictEqual(
  buildRegistration(Object.assign({}, draftOpen, { mode: 'captain' }), 'late3', member, 'captain', 'letmein', noDotaFields, 123).error,
  '分组进行中，只能报名替补',
  '分组阶段不能再报队长'
);

const draftFull = Object.assign({}, draftOpen, {
  registrations: [{ openid: 'p1', role: 'player' }, { openid: 'w1', role: 'waitlist' }],
});
assert.strictEqual(
  buildRegistration(draftFull, 'late4', member, 'waitlist', 'letmein', noDotaFields, 123).error,
  '替补名额已满',
  '替补席位满员时拒绝报名'
);
assert.strictEqual(
  buildRegistration(Object.assign({}, draftOpen, { status: 'battle' }), 'late5', member, 'waitlist', 'letmein', noDotaFields, 123).error,
  '当前不在报名阶段',
  '对战阶段不再允许报名替补'
);
assert.strictEqual(
  buildRegistration(draftOpen, 'late6', member, 'waitlist', 'wrong', noDotaFields, 123).error,
  undefined,
  '分组阶段报名替补免暗号'
);

console.log('Registration validation tests passed.');
