/**
 * 结构单测：拆分后 index.js 的动作清单必须与重构前的 actions 完全一致。
 * 拆分（2026-11-12）时从原 index.js 的 actions 对象逐项抄录；改动动作时同步更新本清单。
 *
 * 说明：本测试需要 wx-server-sdk（node_modules）。未安装时跳过，不算失败。
 */
const EXPECTED_ACTIONS = [
  'initializeDatabase',
  'home',
  'listHistory',
  'lookupDota',
  'saveProfile',
  'initSuperAdmin',
  'getStaff',
  'saveCardStyle',
  'getCardStyles',
  'getPlayerProfile',
  'listUsers',
  'setAdmins',
  'setUserCreatePermission',
  'createTournament',
  'updateConfig',
  'checkSecret',
  'fillTestRegistrations',
  'register',
  'setTeamName',
  'moveRegistration',
  'cancelRegister',
  'removeRegistration',
  'removeWaitlistRegistration',
  'startDraft',
  'pickPlayer',
  'resetDraft',
  'setSeeding',
  'shuffleSeeding',
  'startBracket',
  'setMatchBo',
  'setMatchResult',
  'resetMatchResult',
  'rollbackStage',
  'replacePlayer',
  'swapPlayers',
  'finishTournament',
  'setStandingsOrder',
  'deleteTournament',
  'teamLogoList',
  'autoGroup',
  'confirmGroup',
  'saveAutoGroups',
  'resetGroup',
  'regroup',
  'seedTest',
  'listComments',
  'addComment',
  'tournamentVersion',
  'tournamentRegistrationSnapshot',
  'registrationDetail',
  'tournament',
];

async function main() {
  let mod;
  try {
    mod = require('./index');
  } catch (e) {
    if (/wx-server-sdk/.test(String(e && e.message))) {
      console.log('structure test skipped: wx-server-sdk not installed.');
      return;
    }
    throw e;
  }
  const actions = mod.actions || {};
  const actual = Object.keys(actions).sort();
  const expected = EXPECTED_ACTIONS.slice().sort();
  const missing = expected.filter((name) => !(name in actions));
  const extra = actual.filter((name) => expected.indexOf(name) < 0);
  if (missing.length) throw new Error('缺少动作: ' + missing.join(', '));
  if (extra.length) throw new Error('多出动作: ' + extra.join(', '));
  for (const name of expected) {
    if (typeof actions[name] !== 'function') throw new Error('动作不是函数: ' + name);
  }
  if (typeof mod.main !== 'function') throw new Error('exports.main 不是函数');
  console.log('structure tests passed: ' + expected.length + ' actions intact.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
