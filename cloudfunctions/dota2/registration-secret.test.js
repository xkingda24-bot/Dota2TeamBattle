// 报名暗号可见性契约：报名快照与比赛详情都必须只在创建者/管理员视角返回 secret。
// 2026-11-12 模块化重构后，相关函数分别位于 tournaments.js 与 actions/tournament.js。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

function extractBody(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, '未找到函数：' + startMarker);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end > start ? end : source.length);
}

const tournamentsSource = read('tournaments.js');
const actionsTournamentSource = read('actions/tournament.js');

// 报名页数据源：registrationDetail → getTournamentRegistrationSnapshot（tournaments.js）
const snapshotBody = extractBody(
  tournamentsSource,
  'async function getTournamentRegistrationSnapshot',
  'async function decorateRegistrationSnapshot'
);
assert.ok(snapshotBody.includes('secret: true'), '报名快照投影必须包含 secret 字段');
assert.ok(
  snapshotBody.includes("secret: canManage ? tournament.secret || '' : ''"),
  '报名快照必须仅在 canManage 时返回暗号'
);

// 比赛详情数据源：tournament → composeTournament（tournaments.js）
const composeBody = extractBody(
  tournamentsSource,
  'async function composeTournament',
  'module.exports'
);
assert.ok(
  composeBody.includes("secret: canManage ? t.secret : ''"),
  '比赛详情必须仅在 canManage 时返回暗号'
);

// 详情动作（actions/tournament.js）不得绕过 composeTournament 自组 secret 字段
const tournamentActionBody = extractBody(
  actionsTournamentSource,
  'async tournament(event)',
  '};'
);
assert.ok(
  !/secret\s*:\s*t\b/.test(tournamentActionBody),
  '比赛详情动作不得直接透出 secret'
);

console.log('registration secret visibility contract passed.');
