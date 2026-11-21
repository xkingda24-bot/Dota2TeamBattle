const assert = require('assert');

let definition = null;
global.Component = (value) => { definition = value; };
require('./index.js');
delete global.Component;

const events = [];
let toastText = '';
let modal = null;
global.wx = {
  showToast(options) { toastText = options.title; },
  showModal(options) { modal = options; },
};
const component = {
  data: JSON.parse(JSON.stringify(definition.data)),
  setData(patch) { Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; }); },
  triggerEvent(name, detail) { events.push({ name, detail }); },
};
const target = {
  openid: 'user-a',
  nickname: '队员A',
  dota2Id: '123456',
  ban: { duration: '2d', reason: '迟到', startAt: 1000 },
};
definition.observers['visible, target'].call(component, true);
component.data.target = target;
definition.observers['visible, target'].call(component, true);
assert.strictEqual(component.data.duration, '2d');
assert.strictEqual(component.data.reason, '迟到');
assert(component.data.effectText.includes('按原禁赛开始时间重新计算'));

definition.methods.onSelectDuration.call(component, { currentTarget: { dataset: { value: '4d' } } });
assert.strictEqual(component.data.duration, '4d');
definition.methods.onReasonInput.call(component, { detail: { value: '  多次迟到  ' } });
definition.methods.onSubmit.call(component);
assert.strictEqual(events.length, 1);
assert.deepStrictEqual(events[0].detail, { targetOpenid: 'user-a', duration: '4d', reason: '多次迟到' });

// 永久禁赛必须经过第二次确认才允许发出写操作。
definition.methods.onSelectDuration.call(component, { currentTarget: { dataset: { value: 'permanent' } } });
definition.methods.onSubmit.call(component);
assert.strictEqual(events.length, 1);
assert.strictEqual(modal.title, '确认永久禁赛');
modal.success({ confirm: true });
assert.strictEqual(events.length, 2);
assert.strictEqual(events[1].detail.duration, 'permanent');

// 原因为空时只提示，不提交。
definition.methods.onReasonInput.call(component, { detail: { value: ' ' } });
definition.methods.onSubmit.call(component);
assert.strictEqual(events.length, 2);
assert.strictEqual(toastText, '请填写禁赛原因');

delete global.wx;
console.log('Ban editor duration, reason, adjustment and permanent confirmation tests passed.');
