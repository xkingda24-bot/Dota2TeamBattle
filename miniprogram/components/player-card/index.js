const { DEFAULT_CARD_STYLE, normalizeCardStyle } = require('../../utils/card-style');
const { dotaRankLabel, hasCurrentRankVerification } = require('../../utils/dota-rank');
const { ROLE_NUMS, VERSATILE_LABEL, normalizeRoles, isVersatileText } = require('../../utils/roles');
const { getSeasonCardStats } = require('../../utils/season-points-cache');

Component({
  properties: {
    player: {
      type: Object,
      value: {},
      observer(value) {
        this.updateDotaCard(value);
        this.updateRoleChips(value);
        this.updateSeasonPoints(value);
      },
    },
    cardStyle: {
      type: Object,
      value: DEFAULT_CARD_STYLE,
      observer(value) {
        this.setData({ normalizedStyle: normalizeCardStyle(value) });
      },
    },
    compact: {
      type: Boolean,
      value: false,
    },
    // 名次荣誉文案（如「1 冠 2 亚 4 季」）：由榜单页算好传入，其他页面不传就不显示
    honorsText: {
      type: String,
      value: '',
    },
  },

  data: {
    normalizedStyle: DEFAULT_CARD_STYLE,
    dotaCard: { rankVerified: false, displayText: '', dota2Id: '', rankLabel: '', mmr: null },
    seasonPointsReady: false,
    seasonPoints: '0',
    seasonMatches: '0',
    roleNums: [],
    hasRoleChips: false,
    roleVersatile: false,
  },

  methods: {
    // 位次以数字徽章展示：优先取 roles 数组，缺失时从 rolesText（如「1号位 / 3号位」）解析。
    // 五个位次全选时折叠成单个「全能」徽章（仅展示层折叠，存储仍是真实的 1–5）。
    updateRoleChips(player) {
      const source = player || {};
      let nums = normalizeRoles(source.roles);
      if (!nums.length && typeof source.rolesText === 'string') {
        nums = isVersatileText(source.rolesText)
          ? ROLE_NUMS.slice()
          : normalizeRoles(source.rolesText.match(/[1-5]/g) || []);
      }
      const versatile = nums.length === ROLE_NUMS.length;
      this.setData({
        roleNums: versatile ? [VERSATILE_LABEL] : nums,
        hasRoleChips: nums.length > 0,
        roleVersatile: versatile,
      });
    },
    updateSeasonPoints(player) {
      const openid = String(player && player.openid || '').trim();
      const requestId = (this._seasonPointsRequestId || 0) + 1;
      this._seasonPointsRequestId = requestId;
      this.setData({ seasonPointsReady: false, seasonPoints: '0', seasonMatches: '0' });
      if (!openid) return;
      getSeasonCardStats(openid).then((stats) => {
        if (requestId !== this._seasonPointsRequestId || !stats) return;
        const value = Number(stats.points) || 0;
        this.setData({
          seasonPointsReady: true,
          seasonPoints: Number.isInteger(value) ? String(value) : value.toFixed(1),
          seasonMatches: String(Number(stats.matches) || 0),
        });
      });
    },
    updateDotaCard(player) {
      const source = player || {};
      const dota2Id = String(source.dota2Id || '').trim();
      const mmr = source.mmr === null || source.mmr === undefined || source.mmr === '' ? '' : String(source.mmr);
      const rankVerified = hasCurrentRankVerification(source);
      const rankLabel = rankVerified ? dotaRankLabel(source.dota2RankTier) : '未校验段位';
      const displayText = [
        rankVerified && /^\d{5,12}$/.test(dota2Id) ? dota2Id : '',
        rankLabel,
        mmr,
      ].filter(Boolean).join(' ');
      this.setData({
        dotaCard: {
          rankVerified,
          displayText,
          dota2Id: rankVerified && /^\d{5,12}$/.test(dota2Id) ? dota2Id : '',
          rankLabel,
          mmr: mmr === '' ? null : mmr,
        },
      });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ normalizedStyle: normalizeCardStyle(this.data.cardStyle) });
      this.updateDotaCard(this.data.player);
      this.updateRoleChips(this.data.player);
      this.updateSeasonPoints(this.data.player);
    },
  },
});
