const assert = require('assert');
const { canInitializeSuperAdmin } = require('./bootstrap');

assert.strictEqual(canInitializeSuperAdmin('wx-owner', '', ''), false);
assert.strictEqual(canInitializeSuperAdmin('wx-other', '', 'wx-owner'), false);
assert.strictEqual(canInitializeSuperAdmin('wx-owner', '', ' wx-owner '), true);
assert.strictEqual(canInitializeSuperAdmin('wx-owner', 'wx-owner', 'wx-owner'), false);

console.log('Super admin bootstrap tests passed.');
