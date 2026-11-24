const assert = require('assert');
const { DOTA_HERO_NAMES_ZH, dotaHeroName } = require('./dota-heroes');

assert.strictEqual(Object.keys(DOTA_HERO_NAMES_ZH).length, 127);
assert.strictEqual(dotaHeroName(1, 'Anti-Mage'), '敌法师');
assert.strictEqual(dotaHeroName(2, 'Axe'), '斧王');
assert.strictEqual(dotaHeroName('11', 'Shadow Fiend'), '影魔');
assert.strictEqual(dotaHeroName(14, 'Pudge'), '帕吉');
assert.strictEqual(dotaHeroName(137, 'Primal Beast'), '兽');
assert.strictEqual(dotaHeroName(155, 'Largo'), '朗戈');
assert.strictEqual(dotaHeroName(99999, 'Future Hero'), 'Future Hero');
assert.strictEqual(dotaHeroName(null, ''), '未知英雄');

console.log('Dota hero Chinese name mapping and English fallback tests passed.');
