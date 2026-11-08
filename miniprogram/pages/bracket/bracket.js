// pages/bracket/bracket.js - 对战赛程（双败 / 单败，按比赛 id）
const api = require('../../utils/api');
const { hasCurrentRankVerification, dotaRankLabel } = require('../../utils/dota-rank');
const tournamentPolling = require('../../utils/tournament-polling');
const { TEAM_LOGO_PRESETS } = require('../../utils/team-logos');
const { getTodayBoundary } = require('../../utils/date-time');
const { bracketTypeOf, bracketFormatOf } = require('../../utils/bracket-format');
const { formatRolesText } = require('../../utils/roles');

const BO_LIST = ['BO1', 'BO3', 'BO5'];

function settlementRankLabel(rank, teamCount, formatType) {
  if (rank === 1) return '冠军';
  if (rank === 2) return '亚军';
  // 单败不设三四名决赛，人工排序只给逐人位次，不伪造"季军"
  if (formatType === 'single') return '第' + rank + '名';
  if (rank === 3 && teamCount > 2) return '季军';
  return '第' + rank + '名';
}

function replacementLabel(player) {
  const member = player || {};
  const rankTier = Number(member.dota2RankTier);
  const verified = hasCurrentRankVerification(member);
  const rating = [
    verified ? member.dota2Id : '',
    verified ? dotaRankLabel(rankTier) : '未校验段位',
    member.mmr == null ? '' : String(member.mmr),
  ].filter(Boolean).join(' ');
  return [member.nickname || '队员', rating].filter(Boolean).join(' · ');
}

function teamAverageMmr(members) {
  const list = Array.isArray(members) ? members : [];
  if (!list.length) return 0;
  const total = list.reduce((sum, member) => {
    const mmr = Number(member && member.mmr);
    return sum + (Number.isFinite(mmr) ? mmr : 0);
  }, 0);
  return Math.round(total / list.length);
}

function groupAverageStats(teams) {
  const averages = (Array.isArray(teams) ? teams : [])
    .map((team) => Number(team && team.avgMmr))
    .filter((value) => Number.isFinite(value));
  if (!averages.length) return { max: 0, min: 0, diff: 0 };
  const max = Math.max.apply(null, averages);
  const min = Math.min.apply(null, averages);
  return { max, min, diff: max - min };
}

function orderSettlementItems(items, order, formatType) {
  const byTeamId = {};
  (items || []).forEach((item) => { byTeamId[item.teamId] = item; });
  const ordered = [];
  const seen = {};
  (order || []).forEach((teamId) => {
    const item = byTeamId[teamId];
    if (item && !seen[teamId]) {
      ordered.push(item);
      seen[teamId] = true;
    }
  });
  (items || []).forEach((item) => {
    if (!seen[item.teamId]) ordered.push(item);
  });
  return ordered.map((item, index) => Object.assign({}, item, {
    rank: index + 1,
    label: settlementRankLabel(index + 1, ordered.length, formatType),
    orderIndex: index,
  }));
}

function groupSettlementItems(items) {
  return {
    items,
    podium: items.filter((entry) => Number(entry.rank) <= 3).sort((a, b) => a.rank - b.rank),
    others: items.filter((entry) => Number(entry.rank) > 3).sort((a, b) => a.rank - b.rank),
  };
}

Page({
  data: {
    loading: true,
    t: null,
    loadError: '',
    notFound: false,
    refreshError: false,
    canManage: false,
    canDelete: false,
    settlement: null,
    settlementReady: false,
    settlementEditing: false,
    settlementSaving: false,
    commentText: '',
    commentSaving: false,
    ubMatches: [],
    lbMatches: [],
    gf: null,
    showSeeding: false,
    seedSlots: [],
    teamNames: [],
    teamLogos: [],
    allTeamLogos: [],
    showPanel: false,
    panelMatch: null,
    panelWinner: '',
    scoreA: '',
    scoreB: '',
    showTree: true,
    treeNodes: [],
    treeLines: [],
    treeW: 1200,
    treeH: 800,
    memberPanel: { show: false, title: '', members: [] },
    readonly: false, // 只读模式（历史比赛查看），隐藏所有管理操作
    stageView: '',
    pageTitle: '对战赛程',
    myTeam: null, // 我的战队（我是本队组长/队长）
    // 晋级图第一轮：队伍队名/队标设置弹窗
    teamConfigPanel: { show: false, openid: '', name: '', icon: '', title: '' },
    teamConfigSaving: false,
    replacementTeams: [],
    groupedTeams: [],
    groupAverageStats: { max: 0, min: 0, diff: 0 },
    groupSelection: { teamIndex: -1, openid: '', nickname: '' },
    groupSaving: false,
    groupOrderSaving: false,
    bracketTypeVisible: false,
    bracketTypeSaving: false,
    replacementPanel: { show: false, selecting: '', teamIndex: -1, teamName: '', outPlayers: [], inPlayers: [], outIndex: 0, inIndex: 0, incomingLabel: '' },
    replacementSaving: false,
    grouping: false, // 系统分组：一键重新分组提交中
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    this._flowAnchor = options && options.anchor;
    this._requestedView = options && ['draft', 'battle', 'settlement'].indexOf(options.view) >= 0 ? options.view : '';
    // 显式只读参数只作为内部能力保留；已归档比赛在 load() 里同样按只读处理。
    this._readonlyOption = !!(options && options.readonly === '1');
    this.setData({
      readonly: this._readonlyOption,
      stageView: this._requestedView,
    });
  },

  onOpenGroupSwap(e) {
    const t = this.data.t;
    if (!t || t.mode !== 'auto' || t.status !== 'draft' || !this.data.canManage || this.data.readonly || this.data.groupSaving || this.data.groupOrderSaving) return;
    const teamIndex = Number(e.currentTarget.dataset.teamIndex);
    const openid = e.currentTarget.dataset.openid;
    const team = this.data.groupedTeams[teamIndex];
    const member = team && team.members.find((item) => item.openid === openid);
    if (!member) return;
    const selection = this.data.groupSelection;
    if (selection.openid && selection.teamIndex !== teamIndex) {
      this.swapGroupMembers(selection.teamIndex, selection.openid, teamIndex, openid);
      return;
    }
    if (selection.openid === openid) {
      this.setData({ groupSelection: { teamIndex: -1, openid: '', nickname: '' } });
      return;
    }
    if (selection.openid) {
      wx.showToast({ title: '请选择其他组的队员完成交换', icon: 'none' });
      return;
    }
    this.setData({ groupSelection: { teamIndex, openid, nickname: member.nickname } });
    wx.showToast({ title: '已选择 ' + member.nickname + '，再点其他组队员交换', icon: 'none' });
  },

  clearGroupSelection() {
    this.setData({ groupSelection: { teamIndex: -1, openid: '', nickname: '' } });
  },

  swapGroupMembers(fromTeamIndex, fromOpenid, targetTeamIndex, targetOpenid) {
    const t = this.data.t;
    if (!t || this.data.groupSaving || !this.data.canManage || this.data.readonly) return;
    const groups = this.data.groupedTeams
      .slice()
      .sort((a, b) => a.teamIndex - b.teamIndex)
      .map((team) => team.members.map((member) => member.openid));
    const sourceMembers = groups[fromTeamIndex];
    const targetMembers = groups[targetTeamIndex];
    const sourceIndex = sourceMembers ? sourceMembers.indexOf(fromOpenid) : -1;
    const targetIndex = targetMembers ? targetMembers.indexOf(targetOpenid) : -1;
    if (sourceIndex < 0 || targetIndex < 0) return;
    [sourceMembers[sourceIndex], targetMembers[targetIndex]] = [targetMembers[targetIndex], sourceMembers[sourceIndex]];
    this.setData({ groupSaving: true });
    api.call('saveAutoGroups', { id: t.id, groups })
      .then(() => {
        wx.showToast({ title: '队员已交换', icon: 'success' });
        this.setData({
          groupSaving: false,
          groupSelection: { teamIndex: -1, openid: '', nickname: '' },
        });
        return this.load();
      })
      .catch((error) => {
        this.setData({ groupSaving: false });
        wx.showToast({ title: error.message || '调整分组失败', icon: 'none' });
      });
  },

  onGroupMove(e) {
    const t = this.data.t;
    if (!t || t.mode !== 'auto' || t.status !== 'draft' || !this.data.canManage || this.data.readonly || this.data.groupSaving || this.data.groupOrderSaving) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const dir = Number(e.currentTarget.dataset.dir);
    const seedSlots = this.data.seedSlots.slice();
    const target = slot + dir;
    if (!Number.isInteger(slot) || !Number.isInteger(target) || slot < 0 || target < 0 || target >= seedSlots.length) return;
    [seedSlots[slot], seedSlots[target]] = [seedSlots[target], seedSlots[slot]];
    seedSlots.forEach((item, index) => { item.slot = index; });
    const teamByIndex = {};
    this.data.groupedTeams.forEach((team) => { teamByIndex[team.teamIndex] = team; });
    const groupedTeams = seedSlots.map((item, index) => Object.assign({}, teamByIndex[item.idx], { slot: index }));
    const seeding = seedSlots.map((item) => item.idx);
    this.setData({ seedSlots, groupedTeams, groupOrderSaving: true, groupSelection: { teamIndex: -1, openid: '', nickname: '' } });
    api.call('setSeeding', { id: t.id, seeding })
      .then(() => {
        this.setData({ groupOrderSaving: false });
      })
      .catch((error) => {
        this.setData({ groupOrderSaving: false });
        wx.showToast({ title: error.message || '调整队伍顺序失败', icon: 'none' });
        this.load();
      });
  },

  onOpenGroupSubstitution(e) {
    const t = this.data.t;
    if (!t || t.mode !== 'auto' || t.status !== 'draft' || !this.data.canManage || this.data.readonly || this.data.replacementSaving || this.data.groupSaving || this.data.groupOrderSaving) return;
    const teamIndex = Number(e.currentTarget.dataset.teamIndex);
    const openid = String(e.currentTarget.dataset.openid || '');
    const entry = this.data.replacementTeams.find((team) => team.teamIndex === teamIndex);
    if (!entry) return;
    const outIndex = entry.outPlayers.findIndex((player) => player.openid === openid);
    if (outIndex < 0) return;
    if (!entry.inPlayers.length) {
      wx.showToast({ title: '替补池暂无队员', icon: 'none' });
      return;
    }
    this.setData({
      replacementPanel: Object.assign({}, entry, {
        show: true,
        selecting: 'inIndex',
        outIndex,
        inIndex: 0,
      }),
      groupSelection: { teamIndex: -1, openid: '', nickname: '' },
    });
  },

  scrollToFlowAnchor() {
    const anchor = this._flowAnchor;
    if (!anchor) return;
    this._flowAnchor = '';
    wx.pageScrollTo({ selector: '#' + anchor, duration: 300 });
  },

  onShow() {
    this.loadTeamLogos();
    tournamentPolling.refreshIfChanged(this);
    this.startPoll();
  },

  loadTeamLogos() {
    this.setData({
      teamLogos: TEAM_LOGO_PRESETS,
      allTeamLogos: TEAM_LOGO_PRESETS,
    });
  },
  onHide() {
    this.stopPoll();
  },
  onUnload() {
    this.stopPoll();
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  startPoll() {
    tournamentPolling.start(this);
  },
  stopPoll() {
    tournamentPolling.stop(this);
  },

  redirectToBattle(tournament) {
    if (
      this.data.readonly ||
      this._battleRedirecting ||
      !this._requestedView ||
      this._requestedView === 'battle' ||
      !tournament ||
      tournament.status !== 'battle'
    ) return;
    this._battleRedirecting = true;
    this.stopPoll();
    const id = encodeURIComponent(tournament.id || this.id || '');
    wx.redirectTo({
      url: '/pages/bracket/bracket?id=' + id + '&view=battle',
      fail: () => {
        this._battleRedirecting = false;
        this.startPoll();
      },
    });
  },

  load(silent) {
    if (!silent) this.setData({ loading: true, loadError: '', notFound: false, refreshError: false });
    const data = this.id ? { id: this.id } : {};
    const now = new Date();
    data.todayStart = getTodayBoundary(now);
    return api
      .call('tournament', data)
      .then((t) => {
        // 已归档的比赛数据是历史快照：与历史详情页一致的只读语义，但仍展示完整结算与感言。
        const readonly = this._readonlyOption || !!t.archivedAt;
        if (this.data.readonly !== readonly) this.setData({ readonly });
        this._lastTournamentVersion = tournamentPolling.versionToken(t);
        this._lastFullSyncAt = Date.now();
        const emojiById = {};
        (this.data.allTeamLogos || []).forEach((logo) => (emojiById[logo.id] = logo.emoji));
        // 队伍 openid 形如 'T0'、'T1'…（按 seeding 排序后的落位），反查回 teams 拿队员信息
        const teamMap = {};
        const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : (t.teams || []).map((_, i) => i);
        (t.teams || []).forEach((tm, i) => {
          const slot = seeding.indexOf(i);
          if (slot >= 0) teamMap['T' + slot] = tm;
        });
        const regMap = {};
        (t.registrations || []).forEach((r) => (regMap[r.openid] = r));
        const fmtRoles = (roles) => formatRolesText(roles, '、');
        const cardStyles = t.cardStyles || {};
        const getCardStyle = (member) => {
          if (!member) return null;
          return member.cardStyle || cardStyles[member.openid] || null;
        };
        const buildMembers = (tm) => {
          if (!tm) return null;
          const list = [];
          const capObj = tm.captain && typeof tm.captain === 'object' ? tm.captain : regMap[tm.captain] || null;
          if (capObj) {
            list.push({
              openid: capObj.openid || '',
              nickname: capObj.nickname || '队长',
              mmr: capObj.mmr,
              dota2Id: capObj.dota2Id || '',
              dota2MmrVerified: capObj.dota2MmrVerified,
              dota2RankVerified: capObj.dota2RankVerified,
              dota2RankLabel: capObj.dota2RankLabel || '',
              dota2RankTier: capObj.dota2RankTier,
              dota2LeaderboardRank: capObj.dota2LeaderboardRank,
              dota2RankVerifiedAt: capObj.dota2RankVerifiedAt || capObj.dota2VerifiedAt,
              rolesText: fmtRoles(capObj.roles),
              signature: capObj.signature || '',
              cardStyle: getCardStyle(capObj),
              isCaptain: true,
            });
          }
          (tm.players || []).forEach((p) => {
            const r = p && typeof p === 'object' ? p : regMap[p] || { openid: p, nickname: '队员' };
            list.push({
              openid: r.openid || '',
              nickname: r.nickname || '队员',
              mmr: r.mmr,
              dota2Id: r.dota2Id || '',
              dota2MmrVerified: r.dota2MmrVerified,
              dota2RankVerified: r.dota2RankVerified,
              dota2RankLabel: r.dota2RankLabel || '',
              dota2RankTier: r.dota2RankTier,
              dota2LeaderboardRank: r.dota2LeaderboardRank,
              dota2RankVerifiedAt: r.dota2RankVerifiedAt || r.dota2VerifiedAt,
              rolesText: fmtRoles(r.roles),
              signature: r.signature || '',
              cardStyle: getCardStyle(r),
              isCaptain: false,
            });
          });
          return list;
        };
        // 轮询刷新时保留已展开的抽屉状态
        const prevMatches = (this.data.ubMatches || [])
          .concat(this.data.lbMatches || [])
          .concat(this.data.gf ? [this.data.gf] : []);
        const prevExp = {};
        prevMatches.forEach((m) => {
          if (m) {
            prevExp[m.id + ':A'] = m.expandedA;
            prevExp[m.id + ':B'] = m.expandedB;
          }
        });
        const matches = (t.matches || []).map((m) => {
          const a = teamMap[m.teamAInfo ? m.teamAInfo.openid : ''];
          const b = teamMap[m.teamBInfo ? m.teamBInfo.openid : ''];
          const teamAInfo = m.teamAInfo ? Object.assign({}, m.teamAInfo, { teamIconEmoji: emojiById[m.teamAInfo.teamIcon] || '' }) : null;
          const teamBInfo = m.teamBInfo ? Object.assign({}, m.teamBInfo, { teamIconEmoji: emojiById[m.teamBInfo.teamIcon] || '' }) : null;
          return Object.assign({}, m, {
            boRange: BO_LIST,
            boIndex: Math.max(0, BO_LIST.indexOf(m.bo)),
            showAdmin: t.canManage && !this.data.readonly && t.status === 'battle',
            teamAInfo,
            teamBInfo,
            membersA: buildMembers(a),
            membersB: buildMembers(b),
            expandedA: !!prevExp[m.id + ':A'],
            expandedB: !!prevExp[m.id + ':B'],
          });
        });
        const ubMatches = matches.filter((m) => m.stage === 'upper' || (m.stage || '').indexOf('UB') === 0);
        const lbMatches = matches.filter((m) => m.stage === 'lower' || (m.stage || '').indexOf('LB') === 0);
        const gf = matches.find((m) => m.isChampionMatch) || null;

        const rawGroupedTeams = Array.isArray(t.teams)
          ? t.teams.map((team, teamIndex) => {
            const captain = team && team.captain && typeof team.captain === 'object'
              ? team.captain
              : null;
            const members = [];
            if (captain) members.push(Object.assign({}, captain, { isCaptain: true }));
            (team && Array.isArray(team.players) ? team.players : []).forEach((member) => {
              if (member && typeof member === 'object') members.push(Object.assign({}, member, { isCaptain: false }));
            });
            const name = captain && captain.teamName
              ? captain.teamName
              : captain && captain.nickname
                ? captain.nickname + '战队'
                : '队' + (teamIndex + 1);
            return {
              teamIndex,
              slot: teamIndex,
              name,
              teamIconEmoji: captain ? (emojiById[captain.teamIcon] || '') : '',
              members,
              avgMmr: teamAverageMmr(members),
            };
          })
          : [];
        const groupedTeams = (Array.isArray(t.seeding) && t.seeding.length === rawGroupedTeams.length &&
          t.seeding.every((teamIndex) => Number.isInteger(teamIndex) && teamIndex >= 0 && teamIndex < rawGroupedTeams.length) &&
          new Set(t.seeding).size === rawGroupedTeams.length
          ? t.seeding
          : rawGroupedTeams.map((team) => team.teamIndex))
          .map((teamIndex, slot) => rawGroupedTeams[teamIndex] && Object.assign({}, rawGroupedTeams[teamIndex], { slot }))
          .filter(Boolean);
        const groupAverages = groupAverageStats(groupedTeams);

        // 云函数在总决赛结束后从赛程结果确定性计算排名。只在最终排名完整时展示，
        // 避免比赛进行中把未淘汰队伍误标成具体名次。
        const rawStandings = t.standings && t.standings.complete ? t.standings : null;
        const standingsItems = rawStandings && Array.isArray(rawStandings.items) ? rawStandings.items : [];
        const previousMemberVisibility = {};
        (((this.data.settlement || {}).items) || []).forEach((entry) => {
          previousMemberVisibility[entry.teamId] = !!entry.showMembers;
        });
        let settlementItems = standingsItems.map((entry, index) => {
          const members = Array.isArray(entry.members) ? entry.members.map((member) => Object.assign({}, member, {
            rolesText: fmtRoles(member.roles),
            dota2Id: member.dota2Id || '',
            dota2MmrVerified: member.dota2MmrVerified,
            dota2RankVerified: member.dota2RankVerified,
            dota2RankTier: member.dota2RankTier,
            dota2RankLabel: member.dota2RankLabel || '',
            dota2LeaderboardRank: member.dota2LeaderboardRank,
            dota2RankVerifiedAt: member.dota2RankVerifiedAt || member.dota2VerifiedAt,
            cardStyle: getCardStyle(member),
          })) : [];
          return Object.assign({}, entry, {
            members,
            teamIconEmoji: emojiById[entry.teamIcon] || '',
            showMembers: Object.prototype.hasOwnProperty.call(previousMemberVisibility, entry.teamId)
              ? previousMemberVisibility[entry.teamId]
              : Number(entry.rank) <= 3,
            orderIndex: index,
          });
        });
        const canManageSettlementOrder = !!(
          t.canManage && !this.data.readonly && t.status === 'finished' && t.champion && !t.archivedAt && standingsItems.length
        );
        const settlementEditing = !!(this.data.settlementEditing && canManageSettlementOrder);
        if (settlementEditing) {
          settlementItems = orderSettlementItems(settlementItems, this._settlementDraftIds || [], bracketTypeOf(t));
          this._settlementDraftIds = settlementItems.map((entry) => entry.teamId);
        } else {
          this._settlementDraftIds = null;
        }
        const settlement = settlementItems.length ? Object.assign(groupSettlementItems(settlementItems), {
          comments: (Array.isArray(t.comments) ? t.comments : []).map((comment, index) => Object.assign({}, comment, {
            viewKey: String(comment.createdAt || index) + '-' + index,
          })),
          canComment: !!t.canComment,
          myComment: t.myComment || null,
          canManageOrder: canManageSettlementOrder,
        }) : null;
        const keepRequestedView = this._requestedView && (
          this.data.readonly ||
          (this._requestedView === 'draft' ? t.status === 'draft' :
            this._requestedView === 'battle' ? t.status === 'battle' : t.status === 'finished')
        );
        const stageView = keepRequestedView ? this._requestedView : (
          t.status === 'finished' ? (settlement ? 'settlement' : 'battle') : t.status
        );
        const pageTitle = stageView === 'draft'
          ? (t.mode === 'auto' ? '分组' : '选人/分组')
          : stageView === 'settlement'
            ? '最后结算'
            : '对战赛程';

        let showSeeding = false;
        let seedSlots = [];
        let teamNames = [];
        // 队长选人：选人完成（draftInfo.done）后可调整落位；系统分组：分组完成（draft 状态）直接进入落位调整
        if (t.status === 'draft' && t.canManage && !this.data.readonly && (t.mode === 'auto' || (t.draftInfo && t.draftInfo.done))) {
          showSeeding = true;
          const teams = t.teams || [];
          teamNames = teams.map((tm, i) => (tm.captain
            ? ((tm.captain.teamName || '').trim() || tm.captain.nickname + '战队')
            : '队' + (i + 1)));
          const validSeeding = Array.isArray(t.seeding) && t.seeding.length === teams.length &&
            t.seeding.every((teamIndex) => Number.isInteger(teamIndex) && teamIndex >= 0 && teamIndex < teams.length) &&
            new Set(t.seeding).size === teams.length;
          const seeding = validSeeding ? t.seeding : teams.map((_, i) => i);
          seedSlots = seeding.map((idx, slot) => ({
            slot,
            idx,
            name: teamNames[idx] || '队' + (idx + 1),
            members: buildMembers(teams[idx]) || [],
          }));
        }

        const tree = this.buildTreeData(matches);
        const bracketFormat = bracketFormatOf(t);
        // 晋级图节点里的队伍 openid 是落位编号（T0/T1…），反查 teams 得到真实队长信息
        // 晋级图第一轮（UB1）：标记各队「可设置队名队标」（本队队长或比赛管理者），按钮需携带队长 openid
        const teamBySlot = {};
        (t.teams || []).forEach((tm, i) => {
          const slot = seeding.indexOf(i);
          if (slot >= 0) teamBySlot['T' + slot] = tm;
        });
        tree.nodes.forEach((nd) => {
          const capOf = (src) => {
            if (!src || !src.openid) return null;
            const tm = teamBySlot[src.openid] || null;
            if (!tm) return null;
            return tm.captain && typeof tm.captain === 'object' ? tm.captain : (regMap[tm.captain] || null);
          };
          nd.teamACaptain = capOf(nd.teamAInfo);
          nd.teamBCaptain = capOf(nd.teamBInfo);
          nd.canEditA = !this.data.readonly && (!!t.canManage || !!(nd.teamACaptain && nd.teamACaptain.openid === t.myOpenid));
          nd.canEditB = !this.data.readonly && (!!t.canManage || !!(nd.teamBCaptain && nd.teamBCaptain.openid === t.myOpenid));
        });
        const canReplacePlayers = !!(
          t.canManage && !this.data.readonly && (t.status === 'draft' || t.status === 'battle') &&
          !matches.some((match) => match.status === 'done')
        );
        const captainDraft = t.status === 'draft' && t.mode !== 'auto';
        const incomingPlayers = captainDraft
          ? ((t.draftInfo && t.draftInfo.remainingPlayers) || [])
          : (t.registrations || []).filter((registration) => registration.role === 'waitlist');
        const sourceTeams = captainDraft && t.draftInfo
          ? t.draftInfo.picks
          : (t.teams || []);
        const replacementTeams = canReplacePlayers ? sourceTeams.map((team, teamIndex) => {
          const captain = team.captain && typeof team.captain === 'object' ? team.captain : regMap[team.captain] || {};
          const outPlayers = (team.players || []).map((member) => typeof member === 'object' ? member : regMap[member] || { openid: member, nickname: '队员' });
          if (t.mode === 'auto' && captain.openid) outPlayers.unshift(captain);
          return {
            teamIndex,
            teamName: captain.teamName || captain.nickname + '战队',
            outPlayers: outPlayers.filter((member) => member && member.openid).map((member) => Object.assign({}, member, {
              label: replacementLabel(member),
            })),
            inPlayers: incomingPlayers.map((member) => Object.assign({}, member, {
              label: replacementLabel(member),
            })),
            incomingLabel: captainDraft ? '未选队员' : '替补池',
          };
        }).filter((team) => team.outPlayers.length && team.inPlayers.length) : [];
        // 我是本队组长/队长（auto：天梯分最高；captain：选人开始后的队长）→ 可设置战队名；编辑中不被轮询覆盖
        let myTeam = null;
        if (t.teams && t.myOpenid) {
          const mine = t.teams.find((tm) => tm.captain && tm.captain.openid === t.myOpenid) || null;
          if (mine) {
            myTeam = {
              captain: mine.captain,
              defaultName: mine.captain.nickname + '战队',
              teamIconEmoji: emojiById[mine.captain.teamIcon] || '',
            };
          }
        }
        this.setData({
          t,
          loadError: '',
          notFound: false,
          refreshError: false,
          stageView,
          pageTitle,
          bracketType: bracketFormat.value,
          formatName: bracketFormat.name,
          eliminationHint: bracketFormat.value === 'single'
            ? '胜者晋级，败者直接淘汰（自动）'
            : '胜者晋级，败者跌入败者组或淘汰（自动）',
          seedingTitle: bracketFormat.value === 'single' ? '对阵调整（首轮落位）' : '对阵调整（胜者组第一轮落位）',
          canManage: !!t.canManage,
          // wxml 里的「比赛管理操作」卡片/归档按钮/删除按钮读的是页面级 canDelete，
          // 之前只 setData 了 canManage，导致该卡片永远不渲染（归档入口不可见）。
          canDelete: !!t.canDelete,
          ubMatches,
          lbMatches,
          gf,
          settlement,
          settlementReady: !!settlement,
          settlementEditing,
          commentText: this._commentDirty
            ? this.data.commentText
            : (settlement && settlement.myComment ? settlement.myComment.text : ''),
          showSeeding,
          seedSlots,
          teamNames,
          myTeam,
          replacementTeams,
          groupedTeams,
          groupAverageStats: groupAverages,
          // 赛程未生成时（落位调整阶段）不显示晋级图
          showTree: (t.matches || []).length > 0
            ? (this._treePreferenceSet ? this.data.showTree : true)
            : false,
          treeNodes: tree.nodes,
          treeLines: tree.lines,
          treeW: tree.w,
          treeH: tree.h,
          loading: false,
        }, () => {
          this.scrollToFlowAnchor();
          this.redirectToBattle(t);
        });
        // 注意：这里不再调用 closePanel()——否则 8 秒轮询会把正在填写的"记录结果"弹层关掉
      })
      .catch((e) => {
        const message = e && e.message ? e.message : '加载比赛失败，请重试';
        if (this.data.t) {
          this.setData({ loading: false, refreshError: true, loadError: message });
          if (!silent) wx.showToast({ title: message, icon: 'none' });
          return;
        }
        const notFound = message.indexOf('比赛不存在') >= 0;
        this.setData({ loading: false, t: null, loadError: message, notFound });
        if (!silent) wx.showToast({ title: message, icon: 'none' });
      });
  },

  retryLoad() {
    this.load();
  },

  /* ---------- 系统分组：我的战队命名（组长） ---------- */
  openMyTeamConfig() {
    const myTeam = this.data.myTeam;
    if (!myTeam || !myTeam.captain || !myTeam.captain.openid) return;
    this.setData({
      teamConfigPanel: {
        show: true,
        openid: myTeam.captain.openid,
        name: myTeam.captain.teamName || '',
        icon: myTeam.captain.teamIcon || '',
        title: myTeam.captain.teamName || myTeam.defaultName || '我的战队',
      },
    });
  },

  /* ---------- 晋级图第一轮：队伍队名/队标设置（队长本人或比赛管理者） ---------- */
  openTeamConfig(e) {
    const d = e.currentTarget.dataset || {};
    if (!d.openid) return;
    this.setData({
      teamConfigPanel: {
        show: true,
        openid: d.openid,
        name: d.name || '',
        icon: d.icon || '',
        title: d.title || '设置队名和队标',
      },
    });
  },
  onTeamConfigNameInput(e) {
    this.setData({ 'teamConfigPanel.name': e.detail.value });
  },
  onTeamConfigIconSelect(e) {
    this.setData({ 'teamConfigPanel.icon': e.currentTarget.dataset.id });
  },
  onTeamConfigIconClear() {
    this.setData({ 'teamConfigPanel.icon': '' });
  },
  closeTeamConfig() {
    this.setData({ 'teamConfigPanel.show': false });
  },
  saveTeamConfig() {
    const t = this.data.t;
    const p = this.data.teamConfigPanel;
    if (!t || !p || !p.show || !p.openid || this.data.teamConfigSaving) return;
    const teamName = (p.name || '').trim();
    if (teamName.length > 10) {
      wx.showToast({ title: '战队名最多 10 个字', icon: 'none' });
      return;
    }
    this.setData({ teamConfigSaving: true });
    api
      .call('setTeamName', { id: t.id, openid: p.openid, teamName, teamIcon: p.icon || '' })
      .then(() => {
        wx.showToast({ title: teamName ? '队名已保存' : '已恢复默认队名', icon: 'success' });
        this.setData({ 'teamConfigPanel.show': false });
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
      .finally(() => this.setData({ teamConfigSaving: false }));
  },

  /* ---------- 对阵调整 ---------- */
  onSeedMove(e) {
    if (!this.data.canManage || this.data.readonly || this.data.groupOrderSaving) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const dir = Number(e.currentTarget.dataset.dir);
    const seedSlots = this.data.seedSlots.slice();
    const target = slot + dir;
    if (target < 0 || target >= seedSlots.length) return;
    const tmp = seedSlots[slot];
    seedSlots[slot] = seedSlots[target];
    seedSlots[target] = tmp;
    seedSlots.forEach((s, i) => (s.slot = i));
    this.setData({ seedSlots, groupOrderSaving: true });
    const seeding = seedSlots.map((s) => s.idx);
    api
      .call('setSeeding', { id: this.data.t.id, seeding })
      .then(() => {
        if (this.data.t.mode === 'auto') {
          const teamByIndex = {};
          this.data.groupedTeams.forEach((team) => { teamByIndex[team.teamIndex] = team; });
          this.setData({ groupedTeams: seedSlots.map((item, index) => Object.assign({}, teamByIndex[item.idx], { slot: index })) });
        }
        this.setData({ groupOrderSaving: false });
      })
      .catch((err) => {
        this.setData({ groupOrderSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
        this.load();
      });
  },

  onSeedChange(e) {
    if (!this.data.canManage || this.data.readonly || this.data.groupOrderSaving) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const val = Number(e.detail.value);
    const seedSlots = this.data.seedSlots.slice();
    seedSlots[slot].idx = val;
    seedSlots[slot].name = this.data.teamNames[val];
    this.setData({ seedSlots });
    const seeding = seedSlots.map((s) => s.idx);
    api
      .call('setSeeding', { id: this.data.t.id, seeding })
      .catch((err) => {
        wx.showToast({ title: err.message, icon: 'none' });
        this.load();
      });
  },

  onShuffleSeeding() {
    if (!this.data.canManage || this.data.readonly || this.data.groupOrderSaving) return;
    api
      .call('shuffleSeeding', { id: this.data.t.id })
      .then(() => {
        wx.showToast({ title: '已随机排位', icon: 'success' });
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onStartBracket() {
    const t = this.data.t;
    if (!t || !this.data.canManage || this.data.readonly || t.status !== 'draft' || this.data.groupSaving || this.data.groupOrderSaving || this.data.bracketTypeSaving) return;
    // 生成前先选赛制：双败（TI）或单败；生成后赛制即固定，需要改动只能退回分组重新生成
    this.setData({ bracketTypeVisible: true });
  },

  onCloseBracketType() {
    this.setData({ bracketTypeVisible: false });
  },

  onConfirmBracketType(e) {
    const t = this.data.t;
    const bracketType = e && e.detail ? e.detail.bracketType : '';
    if (!t || (bracketType !== 'single' && bracketType !== 'double')) return;
    if (!this.data.canManage || this.data.readonly || this.data.bracketTypeSaving) return;
    this.setData({ bracketTypeVisible: false, bracketTypeSaving: true });
    api
      .call('startBracket', { id: t.id, bracketType })
      .then(() => {
        this.setData({ bracketTypeSaving: false });
        wx.showToast({ title: '赛程已生成', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ bracketTypeSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  /* ---------- 队伍抽屉 ---------- */
  toggleTeam(e) {
    const id = Number(e.currentTarget.dataset.id);
    const side = e.currentTarget.dataset.side; // 'A' | 'B'
    const key = side === 'A' ? 'expandedA' : 'expandedB';
    const flip = (arr, arrName) => {
      const i = arr.findIndex((m) => m.id === id);
      if (i < 0) return false;
      const next = arr.slice();
      next[i] = Object.assign({}, next[i], { [key]: !next[i][key] });
      this.setData({ [arrName]: next });
      return true;
    };
    if (flip(this.data.ubMatches, 'ubMatches')) return;
    if (flip(this.data.lbMatches, 'lbMatches')) return;
    const gf = this.data.gf;
    if (gf && gf.id === id) {
      this.setData({ gf: Object.assign({}, gf, { [key]: !gf[key] }) });
    }
  },

  /* ---------- 晋级树形图 ---------- */
  onShowTree() {
    this._treePreferenceSet = true;
    this.setData({ showTree: true });
  },
  onHideTree() {
    this._treePreferenceSet = true;
    this.setData({ showTree: false });
  },

  // 树图节点点「队员」→ 弹层展示该队队员
  showMembers(e) {
    const data = e.currentTarget.dataset || {};
    const id = Number(data.mid !== undefined ? data.mid : data.id);
    const side = data.side;
    const all = (this.data.ubMatches || [])
      .concat(this.data.lbMatches || [])
      .concat(this.data.gf ? [this.data.gf] : []);
    const m = all.find((x) => x.id === id);
    if (!m) return;
    const members = side === 'A' ? m.membersA : m.membersB;
    const title = (side === 'A' ? m.displayA : m.displayB) + ' · 队员';
    this.setData({ memberPanel: { show: true, title, members: members || [] } });
  },
  closeMembers() {
    this.setData({ memberPanel: { show: false, title: '', members: [] } });
  },

  toggleSettlementMembers(e) {
    const teamId = String(e.currentTarget.dataset.teamId || '');
    const settlement = this.data.settlement;
    if (!settlement || !teamId) return;
    const items = (settlement.items || []).map((entry) => entry.teamId === teamId
      ? Object.assign({}, entry, { showMembers: !entry.showMembers })
      : entry);
    this.setData({
      settlement: Object.assign({}, settlement, groupSettlementItems(items)),
    });
  },

  onEditSettlementOrder() {
    const settlement = this.data.settlement;
    if (!settlement || !settlement.canManageOrder || this.data.settlementSaving) return;
    this._settlementDraftIds = settlement.items.map((entry) => entry.teamId);
    const items = orderSettlementItems(settlement.items, this._settlementDraftIds, bracketTypeOf(this.data.t));
    this.setData({
      settlementEditing: true,
      settlement: Object.assign({}, settlement, groupSettlementItems(items)),
    });
  },

  onCancelSettlementOrder() {
    if (this.data.settlementSaving) return;
    this._settlementDraftIds = null;
    this.setData({ settlementEditing: false });
    this.load(true);
  },

  moveSettlementItem(e) {
    if (!this.data.settlementEditing || this.data.settlementSaving) return;
    const index = Number(e.currentTarget.dataset.index);
    const direction = Number(e.currentTarget.dataset.direction);
    const order = (this._settlementDraftIds || []).slice();
    const target = index + direction;
    if (!Number.isInteger(index) || !Number.isInteger(target) || index < 0 || target < 0 || target >= order.length) return;
    const current = order[index];
    order[index] = order[target];
    order[target] = current;
    this._settlementDraftIds = order;
    const settlement = this.data.settlement;
    const items = orderSettlementItems(settlement.items, order, bracketTypeOf(this.data.t));
    this.setData({ settlement: Object.assign({}, settlement, groupSettlementItems(items)) });
  },

  onSaveSettlementOrder() {
    const t = this.data.t;
    const settlement = this.data.settlement;
    const order = (this._settlementDraftIds || []).slice();
    if (!t || !settlement || !settlement.canManageOrder || !this.data.settlementEditing || this.data.settlementSaving) return;
    if (order.length !== settlement.items.length || !order.length) {
      wx.showToast({ title: '名次列表不完整', icon: 'none' });
      return;
    }
    this.setData({ settlementSaving: true });
    api.call('setStandingsOrder', { id: t.id, order })
      .then(() => {
        this._settlementDraftIds = null;
        this.setData({ settlementSaving: false, settlementEditing: false });
        wx.showToast({ title: '名次已保存', icon: 'success' });
        this.load(true);
      })
      .catch((err) => {
        this.setData({ settlementSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  onResetSettlementOrder() {
    const t = this.data.t;
    const settlement = this.data.settlement;
    if (!t || !settlement || !settlement.canManageOrder || !this.data.settlementEditing || this.data.settlementSaving) return;
    wx.showModal({
      title: '恢复自动名次',
      content: '将清除手动名次并按比赛结果恢复排名，确定继续？',
      confirmText: '恢复自动',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ settlementSaving: true });
        api.call('setStandingsOrder', { id: t.id, order: [] })
          .then(() => {
            this._settlementDraftIds = null;
            this.setData({ settlementSaving: false, settlementEditing: false });
            wx.showToast({ title: '已恢复自动名次', icon: 'success' });
            this.load(true);
          })
          .catch((err) => {
            this.setData({ settlementSaving: false });
            wx.showToast({ title: err.message, icon: 'none' });
          });
      },
    });
  },

  onCommentInput(e) {
    this._commentDirty = true;
    this.setData({ commentText: e.detail.value });
  },

  onSubmitComment() {
    const t = this.data.t;
    if (!t || !this.data.settlement || !this.data.settlement.canComment || this.data.commentSaving) return;
    const text = String(this.data.commentText || '').trim();
    if (!text) {
      wx.showToast({ title: '请先写下感言', icon: 'none' });
      return;
    }
    if (Array.from(text).length > 100) {
      wx.showToast({ title: '感言最多 100 字', icon: 'none' });
      return;
    }
    this.setData({ commentSaving: true });
    api.call('addComment', { id: t.id, text })
      .then(() => {
        this._commentDirty = false;
        this.setData({ commentSaving: false });
        wx.showToast({ title: this.data.settlement.myComment ? '感言已更新' : '感言已发表', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ commentSaving: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  // 生成树形图布局：胜者组在上、败者组在下；节点绝对定位，连线按晋级关系画折线
  buildTreeData(matches) {
    if (!matches.length) return { nodes: [], lines: [], w: 1200, h: 800 };
    const ORDER = ['UB1', 'UB2', 'UB3', 'UB4', 'UBF', 'GF', 'LB1', 'LB2', 'LB3', 'LB4', 'LBF'];
    const isUB = (s) => s === 'GF' || s.indexOf('UB') === 0;
    const isLB = (s) => s.indexOf('LB') === 0;
    const ubMatches = matches.filter((m) => isUB(m.stage));
    const lbMatches = matches.filter((m) => isLB(m.stage));
    const stageRank = (s) => {
      const i = ORDER.indexOf(s);
      return i < 0 ? 999 : i;
    };
    const ubStagesAll = [...new Set(ubMatches.map((m) => m.stage))].sort((a, b) => stageRank(a) - stageRank(b));
    const ubStages = ubStagesAll.filter((s) => s !== 'GF'); // GF 单独放最右列
    const lbStages = [...new Set(lbMatches.map((m) => m.stage))].sort((a, b) => stageRank(a) - stageRank(b));
    const gfMatch = matches.find((m) => m.stage === 'GF') || null;
    const COLS = Math.max(ubStages.length, lbStages.length);
    const NODE_W = 340;
    const NODE_H = 230;
    const GAP = 70;
    const ZONE_GAP = 150;
    const PAD = 30;
    const COL_W = NODE_W + 50;
    const ubMaxRows = Math.max.apply(null, ubStages.map((s) => ubMatches.filter((m) => m.stage === s).length).concat([1]));
    const lbMaxRows = Math.max.apply(null, lbStages.map((s) => lbMatches.filter((m) => m.stage === s).length).concat([1]));
    const ubH = PAD + ubMaxRows * (NODE_H + GAP);
    // 单败没有败者组：不留败者组区高度，避免晋级图底部出现整块空白
    const hasLower = lbMatches.length > 0;
    const lbH = hasLower ? PAD + lbMaxRows * (NODE_H + GAP) : 0;
    const H = ubH + (hasLower ? ZONE_GAP + lbH : 0) + PAD;
    const W = PAD * 2 + (COLS + (gfMatch ? 1 : 0)) * COL_W;

    const nodeById = {};
    matches.forEach((m) => {
      nodeById[m.id] = m;
    });

    // 每列均布起始 y（胜者组区从顶部，败者组区从胜者组区下方）
    const colStartY = (stage, isLower) => {
      const n = (isLower ? lbMatches : ubMatches).filter((m) => m.stage === stage).length;
      const zoneH = isLower ? lbH : ubH;
      const base = isLower ? ubH + ZONE_GAP : 0;
      return base + (zoneH - n * (NODE_H + GAP) + GAP) / 2;
    };

    // 节点坐标：第一列均布，后续列取同区上游输入的 y 均值（形成树形汇聚）
    const pos = {};
    ubStages.forEach((s, ci) => {
      const list = ubMatches.filter((m) => m.stage === s);
      const startY = colStartY(s, false);
      list.forEach((m, i) => {
        const sameY = ['A', 'B']
          .map((sl) => m['team' + sl])
          .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
          .filter((src) => pos[src.matchId] && isUB(nodeById[src.matchId].stage))
          .map((src) => pos[src.matchId].y);
        pos[m.id] = {
          x: PAD + ci * COL_W,
          y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : startY + i * (NODE_H + GAP),
        };
      });
    });
    lbStages.forEach((s, ci) => {
      const list = lbMatches.filter((m) => m.stage === s);
      const startY = colStartY(s, true);
      list.forEach((m, i) => {
        const sameY = ['A', 'B']
          .map((sl) => m['team' + sl])
          .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
          .filter((src) => pos[src.matchId] && isLB(nodeById[src.matchId].stage))
          .map((src) => pos[src.matchId].y);
        pos[m.id] = {
          x: PAD + ci * COL_W,
          y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : startY + i * (NODE_H + GAP),
        };
      });
    });
    // 总决赛：单独放最右一列，y 取同区（胜者组）输入 UBF 的位置
    if (gfMatch) {
      const sameY = ['A', 'B']
        .map((sl) => gfMatch['team' + sl])
        .filter((src) => src && src.type === 'match' && nodeById[src.matchId])
        .filter((src) => pos[src.matchId] && isUB(nodeById[src.matchId].stage))
        .map((src) => pos[src.matchId].y);
      pos[gfMatch.id] = {
        x: PAD + COLS * COL_W,
        y: sameY.length ? sameY.reduce((a, b) => a + b, 0) / sameY.length : colStartY('GF', false),
      };
    }

    // 同列防重叠：同一分区（胜者组区/败者组区）内同列节点若垂直间距不足，则整列按均布重排
    // 重排起点取「列首节点 y」与「分区底部 - 列所需高度」的较小者，保证不超出分区
    const MIN_GAP = 40;
    const ubBottom = ubH;
    const lbBottom = ubH + ZONE_GAP + lbH;
    const colsMap = {};
    matches.forEach((m) => {
      const p = pos[m.id];
      if (!p) return;
      const zone = p.y < ubBottom ? 'u' : 'l';
      const key = p.x + '|' + zone;
      (colsMap[key] = colsMap[key] || []).push({ id: m.id, y: p.y });
    });
    Object.keys(colsMap).forEach((k) => {
      const list = colsMap[k].sort((a, b) => a.y - b.y);
      const zone = k.split('|')[1];
      const zoneBottom = zone === 'u' ? ubBottom : lbBottom;
      for (let i = 1; i < list.length; i++) {
        if (list[i].y - list[i - 1].y < NODE_H + MIN_GAP) {
          const startY = Math.min(list[0].y, zoneBottom - list.length * (NODE_H + MIN_GAP));
          list.forEach((it, idx) => {
            pos[it.id].y = startY + idx * (NODE_H + MIN_GAP);
          });
          break;
        }
      }
    });

    // 连线：A 位来自上游胜者（金色实线），B 位来自上游败者（灰色虚线）
    // 跨列 → 水平折线（源右边缘 → 目标左边缘）；同列（败者垂直掉落）→ 源底部竖直向下进目标顶部
    const lines = [];
    let lidx = 0;
    matches.forEach((m) => {
      const q = pos[m.id];
      if (!q) return;
      ['A', 'B'].forEach((sl) => {
        const src = m['team' + sl];
        if (!src || src.type !== 'match') return;
        const p = pos[src.matchId];
        if (!p) return;
        const win = sl === 'A';
        const added = [];
        if (q.x >= p.x + NODE_W) {
          // 跨列折线
          const x1 = p.x + NODE_W;
          const y1 = p.y + NODE_H / 2;
          const x2 = q.x;
          const y2 = q.y + NODE_H / 2;
          const xm = (x1 + x2) / 2;
          if (xm - x1 > 0) added.push({ horizontal: true, x: x1, y: y1, w: xm - x1 });
          if (y2 - y1 !== 0) {
            const hh = Math.abs(y2 - y1);
            added.push({ horizontal: false, x: xm, y: y2 - y1 > 0 ? y1 : y2, w: hh });
          }
          if (x2 - xm > 0) added.push({ horizontal: true, x: xm, y: y2, w: x2 - xm });
        } else {
          // 同列垂直掉落
          const sx = p.x + NODE_W / 2;
          const sy = p.y + NODE_H;
          const tx = q.x + NODE_W / 2;
          const ty = q.y;
          if (ty - sy !== 0) {
            const hh = Math.abs(ty - sy);
            added.push({ horizontal: false, x: sx, y: ty - sy > 0 ? sy : ty, w: hh });
          }
          if (Math.abs(tx - sx) > 1) added.push({ horizontal: true, x: Math.min(sx, tx), y: ty, w: Math.abs(tx - sx) });
        }
        added.forEach((sg) => {
          lines.push({ idx: lidx++, type: win ? 'win' : 'lose', horizontal: sg.horizontal, x: sg.x, y: sg.y, w: sg.w });
        });
      });
    });

    const nodes = matches.map((m) => {
      const p = pos[m.id] || { x: 0, y: 0 };
      return {
        id: m.id,
        status: m.status,
        stage: m.stage,
        winner: m.winner,
        teamAInfo: m.teamAInfo,
        displayA: m.displayA,
        scoreA: m.scoreA,
        membersA: m.membersA,
        teamBInfo: m.teamBInfo,
        displayB: m.displayB,
        scoreB: m.scoreB,
        membersB: m.membersB,
        bo: m.bo,
        boRange: m.boRange,
        boIndex: m.boIndex,
        showAdmin: m.showAdmin,
        x: p.x,
        y: p.y,
      };
    });
    return { nodes, lines, w: W, h: H };
  },

  /* ---------- 赛制与结果（比赛管理者） ---------- */
  onBoChange(e) {
    if (this.data.readonly) return;
    const id = Number(e.currentTarget.dataset.id);
    const bo = BO_LIST[Number(e.detail.value)];
    if (!this.data.canManage) return;
    api
      .call('setMatchBo', { id: this.data.t.id, matchId: id, bo })
      .then(() => {
        wx.showToast({ title: '赛制已设为 ' + bo, icon: 'success' });
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  recordResult(e) {
    if (!this.data.canManage || this.data.readonly) return;
    const id = Number(e.currentTarget.dataset.id);
    const match = (this.data.ubMatches.concat(this.data.lbMatches)).find((m) => m.id === id) || this.data.gf;
    if (!match) return;
    if (!match.teamAInfo || !match.teamBInfo) {
      wx.showToast({ title: '对阵未完整，无法记录', icon: 'none' });
      return;
    }
    this.setData({
      showPanel: true,
      panelMatch: match,
      panelWinner: '',
      scoreA: '',
      scoreB: '',
    });
  },

  pickWinner(e) {
    this.setData({ panelWinner: e.currentTarget.dataset.winner });
  },

  onScoreA(e) {
    this.setData({ scoreA: e.detail.value });
  },
  onScoreB(e) {
    this.setData({ scoreB: e.detail.value });
  },

  confirmResult() {
    if (this.data.readonly) return;
    const t = this.data.t;
    const pm = this.data.panelMatch;
    if (!t || !pm || !this.data.panelWinner) {
      wx.showToast({ title: '请选择胜方', icon: 'none' });
      return;
    }
    const data = {
      id: t.id,
      matchId: pm.id,
      winner: this.data.panelWinner,
    };
    if (pm.bo !== 'BO1') {
      data.scoreA = Number(this.data.scoreA);
      data.scoreB = Number(this.data.scoreB);
      if (this.data.scoreA === '' || this.data.scoreB === '') {
        wx.showToast({ title: '请填写比分', icon: 'none' });
        return;
      }
    }
    api
      .call('setMatchResult', data)
      .then((d) => {
        wx.showToast({
          title: d.finished ? '冠军产生：' + d.champion : '已记录，自动晋级',
          icon: 'none',
        });
        this.closePanel();
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  closePanel() {
    this.setData({ showPanel: false });
  },

  resetResult(e) {
    if (this.data.readonly) return;
    const t = this.data.t;
    const id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '修正结果',
      content: '将重置该场结果，并级联重置所有受影响的后续比赛，确定修正？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('resetMatchResult', { id: t.id, matchId: id })
            .then(() => {
              wx.showToast({ title: '已修正', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  /* ---------- 结束 / 归档 / 删除（比赛管理者） ---------- */

  onOpenReplacement(e) {
    if (!this.data.canManage || this.data.readonly || this.data.replacementSaving) return;
    const entry = this.data.replacementTeams[Number(e.currentTarget.dataset.index)];
    if (!entry) return;
    const selectedOpenid = String(e.currentTarget.dataset.openid || '');
    const selectedIndex = selectedOpenid ? entry.outPlayers.findIndex((player) => player.openid === selectedOpenid) : 0;
    if (selectedIndex < 0) return;
    if (!entry.inPlayers.length) {
      wx.showToast({ title: '替补池暂无队员', icon: 'none' });
      return;
    }
    this.setData({
      replacementPanel: Object.assign({}, entry, { show: true, outIndex: selectedIndex, inIndex: 0 }),
    });
  },

  onOpenReplacementOptions(e) {
    const field = e.currentTarget.dataset.field;
    if (field !== 'outIndex' && field !== 'inIndex') return;
    const panel = this.data.replacementPanel;
    const players = field === 'outIndex' ? panel.outPlayers : panel.inPlayers;
    if (!players || !players.length) return;
    this.setData({ 'replacementPanel.selecting': field });
  },

  onSelectReplacementPlayer(e) {
    const field = e.currentTarget.dataset.field;
    const index = Number(e.currentTarget.dataset.index);
    if (field !== 'outIndex' && field !== 'inIndex') return;
    const panel = this.data.replacementPanel;
    const players = field === 'outIndex' ? panel.outPlayers : panel.inPlayers;
    if (!players || !players[index]) return;
    this.setData({
      ['replacementPanel.' + field]: index,
      'replacementPanel.selecting': '',
    });
  },

  onCloseReplacementOptions() {
    this.setData({ 'replacementPanel.selecting': '' });
  },

  onCloseReplacement() {
    if (this.data.replacementSaving) return;
    this.setData({ 'replacementPanel.show': false });
  },

  onConfirmReplacement() {
    const t = this.data.t;
    const panel = this.data.replacementPanel;
    if (!t || !panel.show || !this.data.canManage || this.data.readonly || this.data.replacementSaving) return;
    const outPlayer = panel.outPlayers[panel.outIndex];
    const inPlayer = panel.inPlayers[panel.inIndex];
    if (!outPlayer || !inPlayer) {
      wx.showToast({ title: '请选择换下和换上的队员', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认替换队员',
      content: '将 ' + outPlayer.label + ' 换为 ' + inPlayer.label + '，确定继续？',
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ replacementSaving: true });
        api.call('replacePlayer', {
          id: t.id,
          teamIndex: panel.teamIndex,
          outOpenid: outPlayer.openid,
          inOpenid: inPlayer.openid,
        }).then(() => {
          wx.showToast({ title: '队员已替换', icon: 'success' });
          this.setData({ replacementSaving: false, 'replacementPanel.show': false });
          this.load();
        }).catch((err) => {
          this.setData({ replacementSaving: false });
          wx.showToast({ title: err.message || '替换失败', icon: 'none' });
        });
      },
    });
  },

  onRollbackStage(e) {
    const t = this.data.t;
    const stage = e.currentTarget.dataset.stage;
    if (!t || !this.data.canManage || this.data.readonly || (stage !== 'draft' && stage !== 'registration')) return;
    const toName = stage === 'draft' ? (t.mode === 'auto' ? '分组' : '选人') : '报名';
    const warning = stage === 'draft'
      ? t.mode === 'auto'
        ? '将清除当前赛程和落位，保留现有系统分组结果，返回分组页面继续微调。'
        : '将清除当前赛程和落位，保留选人进度。'
      : '将清除选人、分组、落位和赛程数据，报名名单与队长队名保留。';
    wx.showModal({
      title: '退回' + toName + '阶段',
      content: warning + '确定继续？',
      confirmText: '确认退回',
      success: (result) => {
        if (!result.confirm) return;
        api.call('rollbackStage', { id: t.id, stage })
          .then(() => {
            wx.showToast({ title: '已退回' + toName + '阶段', icon: 'success' });
            this.stopPoll();
            const route = stage === 'registration'
              ? '/pages/register/register'
              : t.mode === 'auto' ? '/pages/bracket/bracket' : '/pages/draft/draft';
            setTimeout(() => wx.redirectTo({ url: route + '?id=' + t.id }), 500);
          })
          .catch((err) => wx.showToast({ title: err.message || '阶段回退失败', icon: 'none' }));
      },
    });
  },

  /* 系统分组：一键重新分组（比赛管理者），保留各队已设置的队名/队标 */
  onRegroup() {
    const t = this.data.t;
    if (!t || this.data.readonly || !this.data.canManage || this.data.grouping) return;
    if (t.mode !== 'auto' || t.status !== 'draft') return;
    wx.showModal({
      title: '重新分组',
      content: '将重新计算并替换当前分组结果（各队已设置的队名/队标保留；组长仍按天梯分最高的前 N 名安排）。若对新结果不满意，可再次点击重分或手动交换队员。确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ grouping: true });
        api
          .call('regroup', { id: t.id })
          .then(() => {
            wx.showToast({ title: '已重新分组', icon: 'success' });
            this.load();
          })
          .catch((err) => wx.showToast({ title: err.message || '重新分组失败', icon: 'none' }))
          .finally(() => this.setData({ grouping: false }));
      },
    });
  },

  /* 系统分组：返回报名阶段重新分组（比赛管理者） */
  onResetGroup() {
    const t = this.data.t;
    if (!t || this.data.readonly) return;
    wx.showModal({
      title: '返回重新分组',
      content: '将撤销当前分组并返回报名阶段（报名名单保留），可重新「进行系统分组」。确定返回？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('resetGroup', { id: t.id })
            .then(() => {
              wx.showToast({ title: '已返回报名阶段', icon: 'success' });
              this.stopPoll();
              setTimeout(() => wx.redirectTo({ url: '/pages/register/register?id=' + t.id }), 600);
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onFinish() {
    const t = this.data.t;
    if (!t || this.data.readonly || !t.canDelete || t.archivedAt) return;
    const isFinished = t.status === 'finished';
    wx.showModal({
      title: isFinished ? '归档比赛' : '结束并归档',
      content: isFinished
        ? '将本场比赛归档到历史比赛（主页不再显示），确定归档？'
        : '结束本场比赛（需已有冠军，未结束不能归档），确定？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('finishTournament', { id: t.id })
            .then(() => {
              this.load();
              return api.callFunction('seasonPoints', 'settleTournament', { tournamentId: t.id })
                .then(() => wx.showToast({ title: '已归档并结算积分', icon: 'success' }))
                .catch((err) => wx.showToast({ title: '赛事已归档，积分待补算：' + (err.message || '服务暂不可用'), icon: 'none' }));
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onDelete() {
    const t = this.data.t;
    // 删除不受只读限制：已归档比赛仍允许创建者或超管删除（与主页历史条目的删除入口一致）。
    if (!t || !t.canDelete) return;
    wx.showModal({
      title: '确认删除？',
      content: '（删除后无法恢复。）',
      confirmText: '删除比赛',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: t.id })
            .then(() => {
              wx.showToast({ title: '比赛已删除', icon: 'success' });
              setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 600);
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
