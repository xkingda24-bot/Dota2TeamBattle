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
    treeW: 800,
    treeH: 500,
  },

  onLoad(options) {
    this.id = (options && options.id) || '';
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
            showAdmin: t.isAdmin,
            membersA: buildMembers(a),
            membersB: buildMembers(b),
            expandedA: !!prevExp[m.id + ':A'],
            expandedB: !!prevExp[m.id + ':B'],
          });
        });
        const ubMatches = matches.filter((m) => m.stage === 'upper');
        const lbMatches = matches.filter((m) => m.stage === 'lower');
        const gf = matches.find((m) => m.isChampionMatch) || null;

        let showSeeding = false;
        let seedSlots = [];
        let teamNames = [];
        if (t.status === 'draft' && t.draftInfo && t.draftInfo.done) {
          showSeeding = true;
          const teams = t.teams || [];
          teamNames = teams.map((tm, i) => (tm.captain ? tm.captain.nickname + '战队' : '队' + (i + 1)));
          const seeding = Array.isArray(t.seeding) && t.seeding.length === t.N ? t.seeding : teams.map((_, i) => i);
          seedSlots = seeding.map((idx, slot) => ({ slot, idx, name: teamNames[idx] || '队' + (idx + 1) }));
        }

        this.setData({
          t,
          isAdmin: !!t.isAdmin,
          ubMatches,
          lbMatches,
          gf,
          showSeeding,
          seedSlots,
          teamNames,
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
  onSeedChange(e) {
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
    if (!t) return;
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
    setTimeout(() => this.drawTree(), 120);
  },
  onHideTree() {
    this.setData({ showTree: false });
  },

  drawTree() {
    const t = this.data.t;
    const matches = (this.data.ubMatches || [])
      .concat(this.data.lbMatches || [])
      .concat(this.data.gf ? [this.data.gf] : []);
    if (!t || !matches.length) return;

    // 列布局（8 队 TI 双败）：胜者组轮与败者组轮交错，总决赛在最后
    const COL_STAGES = ['UB1', 'LB1', 'UB2', 'LB2', 'LB3', 'UBF', 'LBF', 'GF'];
    const colOf = (s) => {
      const i = COL_STAGES.indexOf(s);
      return i >= 0 ? i : COL_STAGES.length;
    };
    const byCol = {};
    matches.forEach((m) => {
      const c = colOf(m.stage);
      (byCol[c] = byCol[c] || []).push(m);
    });
    const colKeys = Object.keys(byCol).map(Number).sort((a, b) => a - b);

    const COL_W = 300;
    const PAD = 24;
    const NODE_H = 96;
    const GAP = 28;
    const maxRows = Math.max.apply(null, colKeys.map((c) => byCol[c].length));
    const H = PAD * 2 + maxRows * (NODE_H + GAP) - GAP;
    const W = PAD * 2 + colKeys.length * COL_W;

    // 先更新画布尺寸（渲染完成后拿 node 绘制），避免 canvas 尺寸与内容不一致
    this.setData({ treeW: W, treeH: H }, () => {
      // 用 type="2d" 同层渲染 canvas，避免真机白屏
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#treeCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const dpr = wx.getSystemInfoSync().pixelRatio || 2;
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);

        ctx.fillStyle = '#131821';
        ctx.fillRect(0, 0, W, H);

        // 每场比赛节点坐标
        const pos = {};
        colKeys.forEach((c) => {
          const list = byCol[c];
          const startY = (H - list.length * (NODE_H + GAP) + GAP) / 2;
          list.forEach((m, i) => {
            pos[m.id] = { x: PAD + c * COL_W, y: startY + i * (NODE_H + GAP) };
          });
        });

        // 先画晋级连线（胜者金色实线，败者灰色虚线）
        matches.forEach((m) => {
          ['A', 'B'].forEach((slot) => {
            const src = m['team' + slot];
            if (!src || src.type !== 'match') return;
            const p = pos[src.matchId];
            const q = pos[m.id];
            if (!p || !q) return;
            const fromX = p.x + COL_W;
            const fromY = p.y + NODE_H / 2;
            const toX = q.x + 6;
            const toY = q.y + NODE_H / 2;
            ctx.strokeStyle = slot === 'A' ? '#e8c27c' : '#556070';
            ctx.lineWidth = 2;
            ctx.setLineDash(slot === 'B' ? [6, 4] : []);
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();
            ctx.setLineDash([]);
          });
        });

        // 再画节点卡片
        matches.forEach((m) => {
          const p = pos[m.id];
          if (!p) return;
          const done = m.status === 'done';
          const bw = COL_W - 20;
          ctx.fillStyle = '#171d29';
          ctx.fillRect(p.x, p.y, bw, NODE_H);
          ctx.strokeStyle = done ? '#e8c27c' : 'rgba(224,181,111,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x, p.y, bw, NODE_H);
          // 场次标签
          ctx.fillStyle = '#6d7480';
          ctx.font = '11px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillText(m.label + (done ? ' · 已结束' : ' · 待打'), p.x + 10, p.y + 14);
          // 两支队伍
          ['A', 'B'].forEach((slot) => {
            const info = m['team' + slot + 'Info'];
            const name = String(m['display' + slot] || '待定');
            const score = slot === 'A' ? m.scoreA : m.scoreB;
            const win = done && info && m.winner === info.openid;
            const y0 = p.y + 26 + (slot === 'A' ? 0 : 34);
            ctx.fillStyle = win ? '#e8c27c' : '#e8e4da';
            ctx.font = '13px sans-serif';
            ctx.fillText(name.slice(0, 11), p.x + 10, y0 + 8);
            if (done) {
              ctx.fillStyle = win ? '#e8c27c' : '#6d7480';
              ctx.font = '12px sans-serif';
              ctx.textAlign = 'right';
              ctx.fillText(String(score == null ? '-' : score), p.x + bw - 10, y0 + 8);
              ctx.textAlign = 'left';
            }
          });
        });
      });
    });
  },

  /* ---------- 赛制与结果（管理员） ---------- */
  onBoChange(e) {
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
    if (!this.data.isAdmin) return;
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

  /* ---------- 结束 / 删除（管理员） ---------- */
  onFinish() {
    const t = this.data.t;
    if (!t) return;
    wx.showModal({
      title: '结束并归档',
      content: '结束本场比赛（需已有冠军），归档后可创建新比赛，确定？',
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
    if (!t) return;
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
