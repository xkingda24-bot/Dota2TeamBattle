const assert = require('assert');
const { TEAM_LOGO_PRESETS, TEAM_LOGO_IDS } = require('./team-logos');

const LEGACY_IDS = [
  'swords', 'emblem', 'dragon', 'wolf', 'bat', 'phoenix', 'skull', 'eagle',
  'snake', 'tiger', 'bear', 'scorpion', 'lion', 'horse', 'wings', 'bolt',
];

assert.strictEqual(TEAM_LOGO_PRESETS.length, 25, 'there should be 25 built-in emoji presets');
assert.strictEqual(new Set(TEAM_LOGO_IDS).size, TEAM_LOGO_IDS.length, 'preset IDs should be unique');
assert.deepStrictEqual(TEAM_LOGO_IDS.slice(0, LEGACY_IDS.length), LEGACY_IDS, 'legacy IDs must keep their meanings');
TEAM_LOGO_PRESETS.forEach((item) => {
  assert(item.name, 'each preset should have a label');
  assert(item.emoji, 'each preset should have an emoji');
});

console.log('team logo presets: ok');
