const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { hasSmurfWarning, shouldShowSmurfWarning } = require('./dota-smurf');
const { rememberViewerOpenid, currentViewerOpenid } = require('./viewer-identity');

assert.strictEqual(hasSmurfWarning({ dota2LookupSnapshot: { recentStats: { total: 20, wins: 17, kda: 3 } } }), true);
assert.strictEqual(hasSmurfWarning({ dota2LookupSnapshot: { recentStats: { total: 20, wins: 16, kda: 4 } } }), true);
assert.strictEqual(hasSmurfWarning({ dota2LookupSnapshot: { recentStats: { total: 20, wins: 15, kda: 4.99 } } }), false);
assert.strictEqual(hasSmurfWarning({ recentStats: { total: 10, wins: 5, kda: 5 } }), true);
assert.strictEqual(hasSmurfWarning({ recentStats: { total: 0, wins: 0, kda: 10 } }), false);
assert.strictEqual(hasSmurfWarning({ dota2SmurfWarning: true }), true);
assert.strictEqual(hasSmurfWarning({ dota2SmurfWarning: false }), false);

const warningPlayer = { openid: 'other', dota2LookupSnapshot: { recentStats: { total: 20, wins: 16, kda: 3 } } };
assert.strictEqual(shouldShowSmurfWarning(warningPlayer, 'me', true), true, '别人可以看到警告');
assert.strictEqual(shouldShowSmurfWarning(Object.assign({}, warningPlayer, { openid: 'me' }), 'me', true), false, '本人看不到自己的警告');
assert.strictEqual(shouldShowSmurfWarning(Object.assign({}, warningPlayer, { isSelf: true }), '', true), false);
assert.strictEqual(shouldShowSmurfWarning(Object.assign({}, warningPlayer, { isMine: true }), '', true), false);
assert.strictEqual(shouldShowSmurfWarning(warningPlayer, 'me', false), false, '校验过期时不显示');

const app = { globalData: { viewerOpenid: '' } };
global.getApp = () => app;
rememberViewerOpenid({ myOpenid: 'me-from-tournament' });
assert.strictEqual(currentViewerOpenid(), 'me-from-tournament');
rememberViewerOpenid({ user: { openid: 'me-from-profile' } });
assert.strictEqual(currentViewerOpenid(), 'me-from-profile');
rememberViewerOpenid({ isSelf: true, openid: 'me-from-career' });
assert.strictEqual(currentViewerOpenid(), 'me-from-career');
rememberViewerOpenid({ isSelf: false, openid: 'someone-else' });
assert.strictEqual(currentViewerOpenid(), 'me-from-career', '查看他人资料不能覆盖当前用户身份');
delete global.getApp;

const componentJs = fs.readFileSync(path.join(__dirname, '../components/player-card/index.js'), 'utf8');
const componentWxml = fs.readFileSync(path.join(__dirname, '../components/player-card/index.wxml'), 'utf8');
const componentWxss = fs.readFileSync(path.join(__dirname, '../components/player-card/index.wxss'), 'utf8');
const registerWxml = fs.readFileSync(path.join(__dirname, '../pages/register/register.wxml'), 'utf8');
assert(componentJs.includes('this.data.allowSmurfWarning && shouldShowSmurfWarning(source, currentViewerOpenid(), rankVerified)'), '名片默认不显示，仅授权页面可开启');
assert(/allowSmurfWarning:\s*\{[\s\S]*?value: false/.test(componentJs), '警告权限必须默认关闭');
assert.strictEqual((registerWxml.match(/allow-smurf-warning="\{\{t\.canManage\}\}"/g) || []).length, 3, '报名页三类名片均仅向管理身份开放');
assert(componentWxml.includes('wx:if="{{smurfWarning}}"'));
assert(componentWxml.includes('⚠️小号警告⚠️'));
assert(componentWxml.includes('smurfWarningSlides'));
assert(componentWxss.includes('@keyframes smurf-warning-scroll'));
assert(componentWxss.includes('animation: smurf-warning-scroll 5s linear infinite'));

console.log('Dota smurf warning thresholds and player-card banner tests passed.');
