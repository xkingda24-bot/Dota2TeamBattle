const assert = require('assert');
const { TEAM_LOGO_PRESETS, TEAM_LOGO_IDS } = require('./team-logos');
const cloudPresets = require('../../cloudfunctions/dota2/team-logos').TEAM_LOGO_PRESETS;

const LEGACY_IDS = [
  'swords', 'emblem', 'dragon', 'wolf', 'bat', 'phoenix', 'skull', 'eagle',
  'snake', 'tiger', 'bear', 'scorpion', 'lion', 'horse', 'wings', 'bolt',
];

assert.deepStrictEqual(TEAM_LOGO_PRESETS, cloudPresets, 'frontend presets must match cloud presets');
assert.strictEqual(TEAM_LOGO_PRESETS.length, 25, 'there should be 25 built-in emoji presets');
assert.strictEqual(new Set(TEAM_LOGO_IDS).size, TEAM_LOGO_IDS.length, 'preset IDs should be unique');
assert.deepStrictEqual(TEAM_LOGO_IDS.slice(0, LEGACY_IDS.length), LEGACY_IDS, 'legacy IDs must keep their order');

console.log('mini-program team logo presets: ok');
