const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hasMissingPublicData } = require('./dota-public-data');

assert.strictEqual(hasMissingPublicData({}), false);
assert.strictEqual(hasMissingPublicData({ dota2PublicDataMissing: true }), true);
assert.strictEqual(hasMissingPublicData({ dota2LookupSnapshot: { recentStats: { total: 0 }, commonHeroes: [] } }), true);
assert.strictEqual(hasMissingPublicData({ dota2LookupSnapshot: { recentStats: { total: 20 }, commonHeroes: [] } }), false);
assert.strictEqual(hasMissingPublicData({ dota2LookupSnapshot: { recentStats: { total: 0 }, commonHeroes: [{ heroId: 2 }] } }), false);

const componentJs = fs.readFileSync(path.join(__dirname, '../components/player-card/index.js'), 'utf8');
assert(componentJs.includes("? '未公开比赛数据'"));
assert(componentJs.includes("'未校验段位'"));
assert(componentJs.includes('rankVerified && hasMissingPublicData(source)'));

console.log('Dota public-data status and player-card state tests passed.');
