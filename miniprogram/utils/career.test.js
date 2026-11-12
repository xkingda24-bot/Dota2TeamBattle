/* 生涯摘要视图模型：兜底、名次样式、摘要截取 */
const assert = require('assert');
const { buildCareerView, summarizeCareer } = require('./career');

const empty = buildCareerView(null, 'self-openid');
assert.strictEqual(empty.openid, 'self-openid');
assert.strictEqual(empty.hasProfile, false);
assert.strictEqual(empty.stats.matches, 0);
assert.strictEqual(empty.stats.winRate, 0);
assert.strictEqual(empty.honorsText, '0 冠 0 亚 0 季');
assert.deepStrictEqual(empty.placements, []);
assert.deepStrictEqual(empty.partners, []);

const result = {
  openid: 'u1',
  profile: { nickname: '夜行者' },
  stats: {
    playedTournaments: 12,
    matches: 55,
    wins: 34,
    losses: 21,
    winRate: 62,
    championships: 3,
    runnerUps: 2,
    thirds: 1,
    captainTimes: 6,
    bestStreak: 5,
    placements: [
      { id: 'a', rank: 1, name: '秋季群赛', matches: 3, wins: 3, losses: 0, date: 0 },
      { id: 'b', rank: 2, name: '夏季群赛', matches: 4, wins: 2, losses: 2 },
      { id: 'c', rank: 4, name: '春季群赛', matches: 0 },
    ],
    partners: [{ openid: 'p1', nickname: '长夜', matches: 6, wins: 4, winRate: 67 }, { openid: 'p2', nickname: '远山', matches: 2, wins: 1, winRate: 50 }],
  },
};
const view = buildCareerView(result, '');
assert.strictEqual(view.hasProfile, true);
assert.strictEqual(view.navTitle, '夜行者 的生涯');
assert.strictEqual(view.placements[0].rankClass, 'gold');
assert.strictEqual(view.placements[0].recordText, '3 胜 0 负');
assert.strictEqual(view.placements[2].recordText, '未记录赛果');
assert.strictEqual(view.placements[2].label, '第 4 名');

const summary = summarizeCareer(view);
assert.strictEqual(summary.placements.length, 2, '摘要只保留最近两条战绩');
assert.strictEqual(summary.partners.length, 1, '摘要只保留一位最佳搭档');
assert.strictEqual(view.placements.length, 3, '完整生涯数据不被摘要修改');

console.log('career view model tests passed.');
