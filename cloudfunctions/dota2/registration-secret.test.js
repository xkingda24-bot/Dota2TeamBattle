// 报名暗号可见性契约：报名快照与比赛详情都必须只在创建者/管理员视角返回 secret。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

function extractBody(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, '未找到函数：' + startMarker);
  const end = source.indexOf(endMarker, start);
  return source.slice(start, end > start ? end : source.length);
}

// 报名页数据源：registrationDetail → getTournamentRegistrationSnapshot
const snapshotBody = extractBody(
  'async function getTournamentRegistrationSnapshot',
  'async function decorateRegistrationSnapshot'
);
assert.ok(snapshotBody.includes('secret: true'), '报名快照投影必须包含 secret 字段');
assert.ok(
  snapshotBody.includes("secret: canManage ? tournament.secret || '' : ''"),
  '报名快照必须仅在 canManage 时返回暗号'
);

// 比赛详情数据源：tournament → composeTournament
const composeBody = extractBody('async function composeTournament', 'async function tournament');
assert.ok(
  composeBody.includes("secret: canManage ? t.secret : ''"),
  '比赛详情必须仅在 canManage 时返回暗号'
);

console.log('registration secret visibility contract passed.');
