// pages/bracket/bracket.js - 对战赛程（TI 双败，按比赛 id）
const api = require('../../utils/api');

const BO_LIST = ['BO1', 'BO3', 'BO5'];

Page({
  data: {
    loading: true,
    t: null,
    isAdmin: false,
    ubMatches: [],
    lbMatches: [],
    gf: null,
    showSeeding: false,
    seedSlots: [],
    teamNames: [],
    showPanel: false,
    panelMatch: null,
    panelWinner: '',
    scoreA: '',
    scoreB: '',
    showTree: false,
    treeNodes: [],
    treeLines: [],
    treeW: 1200,
    treeH: 800,
    memberPanel: { show: false, title: '', members: [] },
    readonly: false, // 只读模式（历史比赛查看），隐藏所有管理操作
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
    this.setData({ readonly: !!(options && options.readonly === '1') });
  },

  onShow() {
    this.load();
    this.startPoll();
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
    this.stopPoll();
    this._timer = setInterval(() => this.load(true), 8000);
  },
  stopPoll() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  load(silent) {
    if (!silent) this.setData({ loading: true });
    const data = this.id ? { id: this.id } : {};
    const now = new Date();
    data.todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return api
      .call('tournament', data)
      .then((t) => {
        // 队伍 openid 形如 'T0'、'T1'…（按 seeding 排序后的落位），反查回 teams 拿队员信息
        const teamMap = {};
        const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : (t.teams || []).map((_, i) => i);
        (t.teams || []).forEach((tm, i) => {
          const slot = seeding.indexOf(i);
          if (slot >= 0) teamMap['T' + slot] = tm;
        });
        const regMap = {};
        (t.registrations || []).forEach((r) => (regMap[r.openid] = r));
        const fmtRoles = (roles) =>
          Array.isArray(roles) && roles.length ? roles.map((x) => x + '号位').join('、') : '';
        const buildMembers = (tm) => {
          if (!tm) return null;
          const list = [];
          const capObj = tm.captain && typeof tm.captain === 'object' ? tm.captain : regMap[tm.captain] || null;
          if (capObj) {
            list.push({
              openid: capObj.openid || '',
              nickname: capObj.nickname || '队长',
              mmr: capObj.mmr,
              rolesText: fmtRoles(capObj.roles),
              signature: capObj.signature || '',
              isCaptain: true,
            });
          }
          (tm.players || []).forEach((p) => {
            const r = p && typeof p === 'object' ? p : regMap[p] || { openid: p, nickname: '队员' };
            list.push({
              openid: r.openid || '',
              nickname: r.nickname || '队员',
              mmr: r.mmr,
              rolesText: fmtRoles(r.roles),
              signature: r.signature || '',
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
          return Object.assign({}, m, {
            boRange: BO_LIST,
            boIndex: Math.max(0, BO_LIST.indexOf(m.bo)),
            showAdmin: t.isAdmin && !this.data.readonly,
            membersA: buildMembers(a),
            membersB: buildMembers(b),
            expandedA: !!prevExp[m.id + ':A'],
            expandedB: !!prevExp[m.id + ':B'],
          });
        });
        const ubMatches = matches.filter((m) => m.stage === 'upper' || (m.stage || '').indexOf('UB') === 0);
        const lbMatches = matches.filter((m) => m.stage === 'lower' || (m.stage || '').indexOf('LB') === 0);
        const gf = matches.find((m) => m.isChampionMatch) || null;

        let showSeeding = false;
        let seedSlots = [];
        let teamNames = [];
        // 队长选人：选人完成（draftInfo.done）后可调整落位；系统分组：分组完成（draft 状态）直接进入落位调整
        if (t.status === 'draft' && !this.data.readonly && (t.mode === 'auto' || (t.draftInfo && t.draftInfo.done))) {
          showSeeding = true;
          const teams = t.teams || [];
          teamNames = teams.map((tm, i) => (tm.captain ? tm.captain.nickname + '战队' : '队' + (i + 1)));
          const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : teams.map((_, i) => i);
          seedSlots = seeding.map((idx, slot) => ({
            slot,
            idx,
            name: teamNames[idx] || '队' + (idx + 1),
            members: buildMembers(teams[idx]) || [],
          }));
        }

        const tree = this.buildTreeData(matches);
        this.setData({
          t,
          isAdmin: !!t.isAdmin,
          ubMatches,
          lbMatches,
          gf,
          showSeeding,
          seedSlots,
          teamNames,
          treeNodes: tree.nodes,
          treeLines: tree.lines,
          treeW: tree.w,
          treeH: tree.h,
          loading: false,
        });
        // 注意：这里不再调用 closePanel()——否则 8 秒轮询会把正在填写的"记录结果"弹层关掉
      })
      .catch((e) => {
        this.setData({ loading: false, t: null });
        if (!silent) wx.showToast({ title: e.message, icon: 'none' });
      });
  },

  /* ---------- 对阵调整 ---------- */
  onSeedMove(e) {
    if (this.data.readonly) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const dir = Number(e.currentTarget.dataset.dir);
    const seedSlots = this.data.seedSlots.slice();
    const target = slot + dir;
    if (target < 0 || target >= seedSlots.length) return;
    const tmp = seedSlots[slot];
    seedSlots[slot] = seedSlots[target];
    seedSlots[target] = tmp;
    seedSlots.forEach((s, i) => (s.slot = i));
    this.setData({ seedSlots });
    const seeding = seedSlots.map((s) => s.idx);
    api
      .call('setSeeding', { id: this.data.t.id, seeding })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onSeedChange(e) {
    if (this.data.readonly) return;
    const slot = Number(e.currentTarget.dataset.slot);
    const val = Number(e.detail.value);
    const seedSlots = this.data.seedSlots.slice();
    seedSlots[slot].idx = val;
    seedSlots[slot].name = this.data.teamNames[val];
    this.setData({ seedSlots });
    const seeding = seedSlots.map((s) => s.idx);
    api
      .call('setSeeding', { id: this.data.t.id, seeding })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  onShuffleSeeding() {
    if (this.data.readonly) return;
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
    if (!t || this.data.readonly) return;
    wx.showModal({
      title: '生成对阵',
      content: '将按当前落位生成 TI 双败赛程并进入对战阶段，确定？',
      success: (res) => {
        if (res.confirm) {
          api
            .call('startBracket', { id: t.id })
            .then(() => {
              wx.showToast({ title: '赛程已生成', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
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
    this.setData({ showTree: true });
  },
  onHideTree() {
    this.setData({ showTree: false });
  },

  // 树图节点点「队员」→ 弹层展示该队队员
  showMembers(e) {
    const id = Number(e.currentTarget.dataset.mid);
    const side = e.currentTarget.dataset.side;
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
    const NODE_H = 180;
    const GAP = 70;
    const ZONE_GAP = 150;
    const PAD = 30;
    const COL_W = NODE_W + 50;
    const ubMaxRows = Math.max.apply(null, ubStages.map((s) => ubMatches.filter((m) => m.stage === s).length).concat([1]));
    const lbMaxRows = Math.max.apply(null, lbStages.map((s) => lbMatches.filter((m) => m.stage === s).length).concat([1]));
    const ubH = PAD + ubMaxRows * (NODE_H + GAP);
    const lbH = PAD + lbMaxRows * (NODE_H + GAP);
    const H = ubH + ZONE_GAP + lbH + PAD;
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

  /* ---------- 赛制与结果（管理员） ---------- */
  onBoChange(e) {
    if (this.data.readonly) return;
    const id = Number(e.currentTarget.dataset.id);
    const bo = BO_LIST[Number(e.detail.value)];
    if (!this.data.isAdmin) return;
    api
      .call('setMatchBo', { id: this.data.t.id, matchId: id, bo })
      .then(() => {
        wx.showToast({ title: '赛制已设为 ' + bo, icon: 'success' });
        this.load();
      })
      .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  recordResult(e) {
    if (!this.data.isAdmin || this.data.readonly) return;
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

  /* ---------- 结束 / 归档 / 删除（管理员） ---------- */
  onFinish() {
    const t = this.data.t;
    if (!t || this.data.readonly) return;
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
              wx.showToast({ title: '已归档', icon: 'success' });
              this.load();
            })
            .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
        }
      },
    });
  },

  onDelete() {
    const t = this.data.t;
    if (!t || this.data.readonly) return;
    wx.showModal({
      title: '删除比赛',
      content: '将永久删除本场比赛的全部数据，不可恢复！确定删除？',
      confirmText: '删除',
      confirmColor: '#e5484d',
      success: (res) => {
        if (res.confirm) {
          api
            .call('deleteTournament', { id: t.id })
            .then(() => {
              wx.showToast({ title: '已删除', icon: 'success' });
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
