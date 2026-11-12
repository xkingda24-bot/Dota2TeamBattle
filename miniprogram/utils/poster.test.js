/**
 * 战报绘制冒烟测试：用桩 canvas 上下文跑完两套模板。
 * 目的不是像素级比对，而是保证：
 *   1. 两套模板在真实数据结构下都能画完不抛错（字段缺失也不崩）
 *   2. 标题、冠军、昵称这些关键文字确实被画到了画布上
 */
const assert = require('assert');
const { drawPoster, POSTER_WIDTH, POSTER_HEIGHT } = require('./poster');

function createStubContext() {
  const drawn = [];
  const records = [];
  const noop = () => {};
  const ctx = {
    drawn,
    records,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    fillText: (text, x, y) => {
      drawn.push(String(text));
      records.push({ text: String(text), y: Number(y) || 0 });
    },
    measureText: (text) => ({ width: String(text).length * 13 }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return ctx;
}

/* 正文区最大 y（排除页脚两行文字） */
function contentMaxY(ctx) {
  return ctx.records
    .filter((record) => record.text !== '刀塔集结 · 小程序生成' && record.text !== '2026/11/13 01:00')
    .reduce((max, record) => Math.max(max, record.y), 0);
}

/* 内容最多时（长标题 + 8 条名次 + 长感言）也不能画到页脚区域 */
function testNoOverflow() {
  const long = createStubContext();
  drawPoster(long, 'tournament', {
    title: '周五内战第十二期 CBF 交叉突围赛暨群友线下聚会特别场',
    metaText: 'CBF 交叉突围 · 8 队 · 每队 2 人 · 2026-11-13 20:00 · 上海市浦东新区某某网咖',
    championName: '战神队',
    championMembers: '队员：阿A · 小B · 阿C · 小D · 阿E · 阿F',
    standings: Array.from({ length: 8 }, (_, index) => ({ label: '第' + (index + 2) + '名', teamName: '队伍' + index })),
    quoteText: '这是一段很长的赛后感想，用来验证折行与高度预算是否生效，写满四行也不应该压到页脚。',
    quoteAuthor: '小B',
    generatedAt: '2026/11/13 01:00',
  });
  const maxY = contentMaxY(long);
  assert.ok(maxY <= POSTER_HEIGHT - 120, '赛事战报正文不应进入页脚区，实际最大 y=' + maxY);

  const dense = createStubContext();
  drawPoster(dense, 'profile', Object.assign({}, profileData, {
    nickname: '一个特别特别长的玩家昵称用来测试折行',
    partners: [
      { nickname: '阿A', matches: 18, winRate: 72 },
      { nickname: '阿B', matches: 12, winRate: 50 },
      { nickname: '阿C', matches: 8, winRate: 38 },
    ],
    recent: [
      { label: '冠军', name: '周五内战', dateText: '2026/11/06' },
      { label: '亚军', name: '周六外战', dateText: '2026/10/30' },
      { label: '季军', name: '月末杯', dateText: '2026/10/23' },
    ],
  }));
  const denseMaxY = contentMaxY(dense);
  assert.ok(denseMaxY <= POSTER_HEIGHT - 120, '生涯战报正文不应进入页脚区，实际最大 y=' + denseMaxY);
}

const tournamentData = {
  title: '周五内战 · 第 12 期 CBF 交叉突围赛',
  metaText: 'CBF 交叉突围 · 8 队 · 每队 2 人 · 2026-11-13',
  championName: '战神队',
  championMembers: '队员：阿A · 小B',
  standings: [
    { label: '亚军', teamName: '梦之队' },
    { label: '季军', teamName: '拆迁办' },
    { label: '第4名', teamName: '野区三兄弟' },
  ],
  quoteText: '这把翻盘太爽了，下次还来。',
  quoteAuthor: '小B',
  generatedAt: '2026/11/13 01:00',
};

const profileData = {
  nickname: '小B',
  metaText: '天梯 5200 · 1 / 3 · 稳定输出',
  playedTournaments: 12,
  winRate: 67,
  wins: 24,
  losses: 12,
  championships: 3,
  bestStreak: 6,
  honorsText: '3 冠 1 亚 0 季',
  seasonPoints: '260',
  seasonMeta: '已结算 9 场',
  partners: [{ nickname: '阿A', matches: 18, winRate: 72 }],
  recent: [{ label: '冠军', name: '周五内战', dateText: '2026/11/06' }],
  generatedAt: '2026/11/13 01:00',
};

function testTournament() {
  const ctx = createStubContext();
  drawPoster(ctx, 'tournament', tournamentData);
  assert.ok(ctx.drawn.some((text) => text.indexOf('赛事战报') >= 0), '赛事战报抬头');
  assert.ok(ctx.drawn.some((text) => text === '战神队'), '冠军队伍名');
  assert.ok(ctx.drawn.some((text) => text.indexOf('翻盘') >= 0), '感言金句');
  assert.ok(ctx.drawn.some((text) => text === '亚军'), '名次行');
}

function testProfile() {
  const ctx = createStubContext();
  drawPoster(ctx, 'profile', profileData);
  assert.ok(ctx.drawn.some((text) => text.indexOf('生涯战报') >= 0), '生涯战报抬头');
  assert.ok(ctx.drawn.some((text) => text === '小B'), '昵称');
  assert.ok(ctx.drawn.some((text) => text === '67'), '胜率数字');
  assert.ok(ctx.drawn.some((text) => text === '260 分'), '赛季积分');
  assert.ok(ctx.drawn.some((text) => text === '阿A'), '最佳搭档');
}

/* 空数据 / 字段缺失：页面在赛事刚创建、玩家没上场时也会进来，不能崩 */
function testEmptyData() {
  ['tournament', 'profile'].forEach((type) => {
    const ctx = createStubContext();
    assert.doesNotThrow(() => drawPoster(ctx, type, {}), type + ' 空数据不应抛错');
    assert.doesNotThrow(() => drawPoster(ctx, type, null), type + ' null 数据不应抛错');
  });
}

assert.strictEqual(POSTER_WIDTH, 750, '海报宽度');
assert.strictEqual(POSTER_HEIGHT, 1200, '海报高度');
testTournament();
testProfile();
testEmptyData();
testNoOverflow();
console.log('poster rendering tests passed.');
