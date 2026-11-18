const assert = require('assert');
const fs = require('fs');
const path = require('path');

const wxml = fs.readFileSync(path.join(__dirname, 'bracket.wxml'), 'utf8');
assert(wxml.includes('class="group-edit-member-row member-detail-row"'), '人员详情应复用系统分组的成员行布局');
assert(
  /<view\s+wx:if="{{p.canReplace}}"[\s\S]*?class="group-edit-replace"[\s\S]*?catchtap="onMemberPanelReplace"[\s\S]*?>替换<\/view>/.test(wxml),
  '人员详情应复用系统分组的小「替换」按钮'
);
assert(!wxml.includes('与替补交换</view>'), '人员详情不再显示名片下方的大交换按钮');
assert(
  wxml.includes('wx:if="{{canManage && !readonly && t.status === \'battle\'}}"'),
  '两种分组模式的房主和管理员在对战阶段都应看到阶段管理入口'
);
assert(
  wxml.includes("{{t.mode === 'auto' ? '退回分组页面' : '退回选人/分组'}}"),
  '队长选人模式应显示「退回选人/分组」按钮'
);
const groupEditStart = wxml.indexOf('id="team-stage-edit-anchor"');
const groupEditEnd = wxml.indexOf('id="team-stage-anchor"');
const groupEditSection = wxml.slice(groupEditStart, groupEditEnd);
assert(
  groupEditSection.includes('<view class="row group-actions">') &&
    groupEditSection.includes('<view class="btn" data-stage="registration" bindtap="onRollbackStage">退回报名阶段</view>'),
  '退回报名阶段按钮应放在重新分组操作区下方，并复用相同样式'
);
assert(groupEditSection.indexOf('<view class="row group-actions">') < groupEditSection.indexOf('data-stage="registration"'));
assert(!wxml.includes('<view class="btn btn-plain" data-stage="registration"'), '退回报名按钮应统一使用主按钮样式');

let pageDefinition = null;
global.Page = (definition) => { pageDefinition = definition; };
require('./bracket.js');
delete global.Page;

function createPage(overrides) {
  const page = Object.assign({}, pageDefinition);
  page.data = Object.assign(JSON.parse(JSON.stringify(pageDefinition.data)), overrides || {});
  page.setData = function setData(patch) {
    Object.keys(patch).forEach((key) => { this.data[key] = patch[key]; });
  };
  return page;
}

const captain = { openid: 'captain', nickname: '原队长', isCaptain: true };
const player = { openid: 'player', nickname: '正式队员' };
const substitute = { openid: 'sub', nickname: '替补' };
const match = {
  id: 1,
  displayA: '夜魇',
  teamAInfo: { openid: 'T0' },
  membersA: [captain, player],
};
const replacementTeam = {
  teamIndex: 1,
  teamName: '夜魇',
  outPlayers: [captain, player],
  inPlayers: [substitute],
  captainInPlayers: [substitute],
};

const managerPage = createPage({
  canManage: true,
  readonly: false,
  ubMatches: [match],
  t: { N: 2, seeding: [1, 0], teams: [{}, {}], matches: [], status: 'battle' },
  replacementTeams: [replacementTeam],
  waitlistPlayers: [substitute],
});
pageDefinition.showMembers.call(managerPage, { currentTarget: { dataset: { mid: 1, side: 'A' } } });
assert.strictEqual(managerPage.data.memberPanel.teamIndex, 1, '应按落位 seeding 找回真实队伍索引');
assert.strictEqual(managerPage.data.memberPanel.members[0].canReplace, true, '对战阶段队长模式允许替换队长');
assert.strictEqual(managerPage.data.memberPanel.members[1].canReplace, true);
assert(managerPage.data.memberPanel.hint.includes('点击「替换」'));

pageDefinition.onMemberPanelReplace.call(managerPage, { currentTarget: { dataset: { openid: 'captain' } } });
assert.strictEqual(managerPage.data.memberPanel.show, false, '替换后先收起人员详情');
assert.strictEqual(managerPage.data.rosterReplacement.show, true, '应直接弹出换上队员列表');
assert.strictEqual(managerPage.data.rosterReplacement.teamIndex, 1);
assert.strictEqual(managerPage.data.rosterReplacement.outOpenid, 'captain', '换下者应为被点击的队员');
assert.strictEqual(managerPage.data.rosterReplacement.outIsCaptain, true);
assert.deepStrictEqual(managerPage.data.rosterReplacement.inPlayers.map((item) => item.openid), ['sub'], '队长只能由替补接任');

const scoredPage = createPage({
  canManage: true,
  readonly: false,
  ubMatches: [match],
  t: { N: 2, seeding: [1, 0], teams: [{}, {}], matches: [{ status: 'done' }], status: 'battle' },
  replacementTeams: [],
  waitlistPlayers: [substitute],
});
pageDefinition.showMembers.call(scoredPage, { currentTarget: { dataset: { mid: 1, side: 'A' } } });
assert(scoredPage.data.memberPanel.members.every((member) => !member.canReplace));
assert(scoredPage.data.memberPanel.hint.includes('已有比赛记录比分'));

const ordinaryPage = createPage({
  canManage: false,
  readonly: false,
  ubMatches: [match],
  t: { N: 2, seeding: [1, 0], teams: [{}, {}], matches: [], status: 'battle' },
  replacementTeams: [],
  waitlistPlayers: [substitute],
});
pageDefinition.showMembers.call(ordinaryPage, { currentTarget: { dataset: { mid: 1, side: 'A' } } });
assert(ordinaryPage.data.memberPanel.members.every((member) => !member.canReplace));
assert.strictEqual(ordinaryPage.data.memberPanel.hint, '');

console.log('Bracket member panel substitution tests passed.');
