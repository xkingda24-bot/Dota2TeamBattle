const assert = require('assert');
const { buildBracket } = require('./bracket');

function makeTeams(n) {
  return Array.from({ length: n }, (_, index) => ({ openid: 't' + index, name: '队' + (index + 1) }));
}

function srcLabel(source) {
  if (!source) return '-';
  if (source.type === 'team') return source.name;
  return '#' + source.matchId + (source.slot === 'winner' ? '胜' : '负');
}

function byId(a, b) {
  return Number(a.id) - Number(b.id);
}

function matchLine(match) {
  return [match.stage, match.id, srcLabel(match.teamA), srcLabel(match.teamB)];
}

/* 8 队双败：胜者组 7 场 + 败者组 6 场 + 总决赛 1 场 */
{
  const matches = buildBracket(makeTeams(8));
  assert.strictEqual(matches.length, 14, '8 队双败应为 14 场');
  const stages = matches.map((match) => match.stage).join(' ');
  assert.strictEqual(
    stages,
    'UB1 UB1 UB1 UB1 UB2 UB2 UBF LB1 LB1 LB2 LB2 LB3 LBF GF',
    '8 队双败的轮次顺序不对'
  );
}

/* 跨半区配对：LB2 的每个上区败者，必须来自另一半区 */
{
  const matches = buildBracket(makeTeams(8));
  const lb2 = matches.filter((match) => match.stage === 'LB2').sort(byId);
  assert.deepStrictEqual(
    lb2.map(matchLine),
    [
      ['LB2', 10, '#8胜', '#6负'], // 上半区幸存者 vs 下半区掉下来的
      ['LB2', 11, '#9胜', '#5负'],
    ],
    '8 队 LB2 应跨半区配对'
  );
  // 首轮仍按相邻败者配对，未被跨半区改动
  const lb1 = matches.filter((match) => match.stage === 'LB1').sort(byId);
  assert.deepStrictEqual(
    lb1.map(matchLine),
    [
      ['LB1', 8, '#1负', '#2负'],
      ['LB1', 9, '#3负', '#4负'],
    ],
    'LB1 仍应是胜者组第一轮相邻败者配对'
  );
}

/* 16 队：LB2 与 LB4 都要跨半区，败者组共 14 场 */
{
  const matches = buildBracket(makeTeams(16));
  assert.strictEqual(matches.length, 30, '16 队双败应为 30 场');
  const lb2 = matches.filter((match) => match.stage === 'LB2').sort(byId);
  assert.deepStrictEqual(
    lb2.map(matchLine),
    [
      ['LB2', 20, '#16胜', '#11负'],
      ['LB2', 21, '#17胜', '#12负'],
      ['LB2', 22, '#18胜', '#9负'],
      ['LB2', 23, '#19胜', '#10负'],
    ],
    '16 队 LB2 应跨半区配对'
  );
  const lb4 = matches.filter((match) => match.stage === 'LB4').sort(byId);
  assert.deepStrictEqual(
    lb4.map(matchLine),
    [
      ['LB4', 26, '#24胜', '#14负'],
      ['LB4', 27, '#25胜', '#13负'],
    ],
    '16 队 LB4 应跨半区配对'
  );
}

/* 4 队：只有一次合并（LBF），1 对 1，跨半区退化为唯一配对 */
{
  const matches = buildBracket(makeTeams(4));
  assert.strictEqual(matches.length, 6, '4 队双败应为 6 场');
  const lbf = matches.find((match) => match.stage === 'LBF');
  assert.deepStrictEqual(
    matchLine(lbf),
    ['LBF', 5, '#4胜', '#3负'],
    '4 队 LBF 应是败者组幸存者 vs 胜者组决赛败者'
  );
}

console.log('Double elimination bracket tests passed for cross-half lower bracket pairing.');
