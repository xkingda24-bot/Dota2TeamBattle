/**
 * 战报长图绘制（canvas 2d，纯绘制函数，不依赖页面）。
 *
 * 设计尺寸固定 750 × 1200（导出 750×1200 图），页面负责准备 canvas 节点与导出：
 *   const canvas = ...; canvas.width = POSTER_WIDTH; canvas.height = POSTER_HEIGHT;
 *   drawPoster(canvas.getContext('2d'), type, data);
 *
 * 两套模板：
 *   'tournament' 赛事战报：冠军、最终名次、感言金句
 *   'profile'    生涯战报：核心数据、赛季积分、最佳搭档、最近战绩
 */

const POSTER_WIDTH = 750;
const POSTER_HEIGHT = 1200;
const PAD = 56;
const CONTENT_WIDTH = POSTER_WIDTH - PAD * 2;

const COLOR = {
  bg: '#0d1017',
  card: '#151b26',
  gold: '#e8c27c',
  goldDim: '#b99a63',
  text: '#e8e4da',
  sub: '#8b94a1',
  faint: '#6d7480',
  green: '#5fd08e',
  line: 'rgba(224, 181, 111, 0.24)',
};

const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';

function font(size, weight) {
  return (weight || 400) + ' ' + size + 'px ' + FONT;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** 按宽度折行，超过 maxLines 时最后一行截断加省略号 */
function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(String(text == null ? '' : text));
  const lines = [];
  let line = '';
  chars.forEach((char) => {
    if (char === '\n') {
      lines.push(line);
      line = '';
      return;
    }
    const candidate = line + char;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  if (!lines.length) return [''];
  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  let last = clipped[maxLines - 1];
  while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
  clipped[maxLines - 1] = last + '…';
  return clipped;
}

function drawLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawBackground(ctx) {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  const glow = ctx.createLinearGradient(0, 0, 0, 420);
  glow.addColorStop(0, 'rgba(224, 181, 111, 0.16)');
  glow.addColorStop(1, 'rgba(224, 181, 111, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, POSTER_WIDTH, 420);
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, POSTER_WIDTH - 48, POSTER_HEIGHT - 48);
}

function drawHeader(ctx, kicker, title, metaText) {
  let y = 88;
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.gold;
  ctx.font = font(22, 500);
  ctx.fillText(kicker, PAD, y);
  y += 44;

  ctx.fillStyle = COLOR.text;
  ctx.font = font(46, 700);
  const titleLines = wrapText(ctx, title, CONTENT_WIDTH, 2);
  y = drawLines(ctx, titleLines, PAD, y, 58);

  if (metaText) {
    ctx.fillStyle = COLOR.sub;
    ctx.font = font(24, 400);
    y += 10;
    y = drawLines(ctx, wrapText(ctx, metaText, CONTENT_WIDTH, 2), PAD, y, 34);
  }
  y += 26;
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(POSTER_WIDTH - PAD, y);
  ctx.stroke();
  return y + 34;
}

function drawFooter(ctx, generatedAt) {
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, POSTER_HEIGHT - 104);
  ctx.lineTo(POSTER_WIDTH - PAD, POSTER_HEIGHT - 104);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.faint;
  ctx.font = font(22, 400);
  ctx.fillText('刀塔集结 · 小程序生成', PAD, POSTER_HEIGHT - 78);
  ctx.textAlign = 'right';
  ctx.fillText(generatedAt || '', POSTER_WIDTH - PAD, POSTER_HEIGHT - 78);
  ctx.textAlign = 'left';
}

function drawSectionTitle(ctx, text, y) {
  ctx.fillStyle = COLOR.goldDim;
  ctx.font = font(24, 500);
  ctx.fillText(text, PAD, y);
  return y + 44;
}

function drawTournamentPoster(ctx, data) {
  drawBackground(ctx);
  let y = drawHeader(ctx, '刀塔集结 · 赛事战报', data.title, data.metaText);
  const limit = POSTER_HEIGHT - 140; // 页脚以上必须留出的安全线
  const cardHeight = 214;

  // 冠军卡片
  roundRect(ctx, PAD, y, CONTENT_WIDTH, cardHeight, 20);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.strokeStyle = 'rgba(232, 194, 124, 0.42)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = COLOR.gold;
  ctx.font = font(22, 500);
  ctx.fillText('冠 军', PAD + 32, y + 26);

  ctx.fillStyle = COLOR.gold;
  ctx.font = font(52, 700);
  let cy = y + 66;
  cy = drawLines(ctx, wrapText(ctx, data.championName || '冠军待定', CONTENT_WIDTH - 64, 1), PAD + 32, cy, 60);

  if (data.championMembers) {
    ctx.fillStyle = COLOR.sub;
    ctx.font = font(24, 400);
    drawLines(ctx, wrapText(ctx, data.championMembers, CONTENT_WIDTH - 64, 2), PAD + 32, cy + 12, 34);
  }
  y += cardHeight + 40;

  // 名次行数按剩余高度动态给：标题/赛制/感言都长时，先牺牲靠后的名次，不压页脚
  const allRows = Array.isArray(data.standings) ? data.standings.slice(0, 8) : [];
  const rowHeight = 62;
  const quoteReserve = data.quoteText ? (44 + 3 * 40 + 34) : 0;
  let rowCount = 0;
  if (allRows.length) {
    const available = limit - y - 44 - 16 - quoteReserve;
    rowCount = Math.max(0, Math.min(allRows.length, 6, Math.floor(available / rowHeight)));
  }
  if (rowCount > 0) {
    y = drawSectionTitle(ctx, '最终名次', y);
    allRows.slice(0, rowCount).forEach((row) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      roundRect(ctx, PAD, y, CONTENT_WIDTH, 52, 12);
      ctx.fill();

      ctx.fillStyle = COLOR.goldDim;
      ctx.font = font(22, 500);
      ctx.fillText(String(row.label || ''), PAD + 22, y + 15);

      ctx.fillStyle = COLOR.text;
      ctx.font = font(30, 500);
      const name = String(row.teamName || '');
      let fitted = name;
      while (fitted && ctx.measureText(fitted).width > CONTENT_WIDTH - 200) fitted = fitted.slice(0, -1);
      ctx.fillText(fitted === name ? name : fitted + '…', PAD + 168, y + 11);
      y += rowHeight;
    });
    y += 16;
  }

  // 感言金句
  if (data.quoteText) {
    const remaining = limit - y - 44 - 34;
    const maxLines = Math.max(1, Math.min(4, Math.floor(remaining / 40)));
    y = drawSectionTitle(ctx, '赛后感言', y);
    ctx.fillStyle = '#cfd6df';
    ctx.font = font(26, 400);
    y = drawLines(ctx, wrapText(ctx, '「' + data.quoteText + '」', CONTENT_WIDTH, maxLines), PAD, y, 40);
    if (data.quoteAuthor) {
      ctx.fillStyle = COLOR.faint;
      ctx.font = font(24, 400);
      ctx.textAlign = 'right';
      ctx.fillText('— ' + data.quoteAuthor, POSTER_WIDTH - PAD, y + 10);
      ctx.textAlign = 'left';
    }
  } else if (!rowCount) {
    ctx.fillStyle = COLOR.sub;
    ctx.font = font(26, 400);
    drawLines(ctx, wrapText(ctx, '总决赛还没打完，名次与感言会在结算后出现在这里。', CONTENT_WIDTH, 3), PAD, y, 40);
  }

  drawFooter(ctx, data.generatedAt);
}

function drawMetricBlock(ctx, x, y, width, value, unit, label) {
  ctx.fillStyle = COLOR.gold;
  ctx.font = font(56, 700);
  const valueText = String(value == null ? 0 : value);
  ctx.fillText(valueText, x, y);
  if (unit) {
    const valueWidth = ctx.measureText(valueText).width;
    ctx.fillStyle = COLOR.goldDim;
    ctx.font = font(24, 400);
    ctx.fillText(unit, x + valueWidth + 4, y + 26);
  }
  ctx.fillStyle = COLOR.sub;
  ctx.font = font(22, 400);
  ctx.fillText(label, x, y + 74);
}

function drawProfilePoster(ctx, data) {
  drawBackground(ctx);
  let y = drawHeader(ctx, '刀塔集结 · 生涯战报', data.nickname || '玩家', data.metaText);

  // 核心数据卡
  const cardHeight = 200;
  roundRect(ctx, PAD, y, CONTENT_WIDTH, cardHeight, 20);
  ctx.fillStyle = COLOR.card;
  ctx.fill();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const columnWidth = CONTENT_WIDTH / 3;
  drawMetricBlock(ctx, PAD + 32, y + 34, columnWidth, data.playedTournaments, '场', '参赛');
  drawMetricBlock(ctx, PAD + 32 + columnWidth, y + 34, columnWidth, data.winRate, '%',
    (Number(data.wins) || 0) + ' 胜 ' + (Number(data.losses) || 0) + ' 负');
  drawMetricBlock(ctx, PAD + 32 + columnWidth * 2, y + 34, columnWidth, data.championships, '', '冠军');

  ctx.fillStyle = COLOR.faint;
  ctx.font = font(22, 400);
  ctx.fillText(data.honorsText || '', PAD + 32, y + cardHeight - 40);
  if (data.bestStreak > 0) {
    ctx.textAlign = 'right';
    ctx.fillText('最佳连胜 ' + data.bestStreak + ' 场', POSTER_WIDTH - PAD - 32, y + cardHeight - 40);
    ctx.textAlign = 'left';
  }
  y += cardHeight + 40;

  // 赛季积分
  if (data.seasonPoints) {
    roundRect(ctx, PAD, y, CONTENT_WIDTH, 118, 18);
    ctx.fillStyle = 'rgba(224, 181, 111, 0.08)';
    ctx.fill();
    ctx.strokeStyle = COLOR.line;
    ctx.stroke();

    ctx.fillStyle = COLOR.sub;
    ctx.font = font(22, 400);
    ctx.fillText('本赛季积分', PAD + 28, y + 26);

    ctx.fillStyle = COLOR.gold;
    ctx.font = font(46, 700);
    ctx.fillText(data.seasonPoints + ' 分', PAD + 28, y + 56);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLOR.faint;
    ctx.font = font(22, 400);
    ctx.fillText(data.seasonMeta || '', POSTER_WIDTH - PAD - 28, y + 62);
    ctx.textAlign = 'left';
    y += 118 + 40;
  }

  // 最佳搭档 + 最近战绩：按剩余高度分配行数，标题长、内容多时自动少画一行，不压页脚
  const limit = POSTER_HEIGHT - 140;
  const allPartners = Array.isArray(data.partners) ? data.partners.slice(0, 3) : [];
  const allRecent = Array.isArray(data.recent) ? data.recent.slice(0, 3) : [];
  const partnerBlock = (count) => (count > 0 ? 44 + count * 64 + 16 : 0);
  const recentBlock = (count) => (count > 0 ? 44 + count * 52 : 0);
  let partnerRows = allPartners.length;
  let recentRows = allRecent.length;
  while (partnerRows + recentRows > 0 && y + partnerBlock(partnerRows) + recentBlock(recentRows) > limit) {
    if (recentRows >= partnerRows && recentRows > 0) recentRows -= 1;
    else if (partnerRows > 0) partnerRows -= 1;
    else break;
  }

  if (partnerRows > 0) {
    y = drawSectionTitle(ctx, '最佳搭档', y);
    allPartners.slice(0, partnerRows).forEach((partner) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      roundRect(ctx, PAD, y, CONTENT_WIDTH, 54, 12);
      ctx.fill();
      ctx.fillStyle = COLOR.text;
      ctx.font = font(28, 500);
      ctx.fillText(String(partner.nickname || '队友'), PAD + 22, y + 13);
      ctx.textAlign = 'right';
      ctx.fillStyle = COLOR.sub;
      ctx.font = font(22, 400);
      ctx.fillText('同队 ' + partner.matches + ' 场 · 胜率 ' + partner.winRate + '%', POSTER_WIDTH - PAD - 22, y + 17);
      ctx.textAlign = 'left';
      y += 64;
    });
    y += 16;
  }

  if (recentRows > 0) {
    y = drawSectionTitle(ctx, '最近战绩', y);
    allRecent.slice(0, recentRows).forEach((item) => {
      ctx.fillStyle = COLOR.goldDim;
      ctx.font = font(24, 500);
      ctx.fillText(String(item.label || ''), PAD, y + 6);

      ctx.fillStyle = COLOR.text;
      ctx.font = font(26, 400);
      let name = String(item.name || '');
      while (name && ctx.measureText(name).width > CONTENT_WIDTH - 170) name = name.slice(0, -1);
      ctx.fillText(name, PAD + 150, y + 4);

      ctx.textAlign = 'right';
      ctx.fillStyle = COLOR.faint;
      ctx.font = font(22, 400);
      ctx.fillText(item.dateText || '', POSTER_WIDTH - PAD, y + 8);
      ctx.textAlign = 'left';
      y += 52;
    });
  }

  drawFooter(ctx, data.generatedAt);
}

function drawPoster(ctx, type, data) {
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (type === 'profile') {
    drawProfilePoster(ctx, data || {});
  } else {
    drawTournamentPoster(ctx, data || {});
  }
}

module.exports = { POSTER_WIDTH, POSTER_HEIGHT, drawPoster, wrapText };
