const { DEFAULT_CARD_STYLE, normalizeCardStyle } = require('../../utils/card-style');
const { dotaRankDisplayLabel, hasCurrentRankVerification } = require('../../utils/dota-rank');
const { shouldShowSmurfWarning } = require('../../utils/dota-smurf');
const { currentViewerOpenid } = require('../../utils/viewer-identity');
const { hasMissingPublicData } = require('../../utils/dota-public-data');
const { ROLE_NUMS, VERSATILE_LABEL, normalizeRoles, isVersatileText } = require('../../utils/roles');
const { getSeasonCardStats } = require('../../utils/season-points-cache');
const { formatHonors } = require('../../utils/honors');

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
    // 名次荣誉文案（如「1 冠 2 亚 4 季」）：不传时组件自己算（来自 getCardPoints），传了以传入值为准
    allowSmurfWarning: {
      type: Boolean,
      value: false,
      observer() {
        this.updateDotaCard(this.data.player);
      },
    },
    honorsText: {
      type: String,
      value: '',
    },
  },

  data: {
    normalizedStyle: DEFAULT_CARD_STYLE,
    dotaCard: { rankVerified: false, publicDataMissing: false, displayText: '', dota2Id: '', rankLabel: '', mmr: null },
    smurfWarning: false,
    smurfWarningSlides: [0, 1, 2, 3],
    seasonPointsReady: false,
    seasonPoints: '0',
    seasonMatches: '0',
    // 组件自己从赛季数据算出的冠亚季文案；外部传入的 honorsText 优先（榜单页仍可覆盖）
    seasonHonorsText: '',
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
      this.setData({ seasonPointsReady: false, seasonPoints: '0', seasonMatches: '0', seasonHonorsText: '' });
      if (!openid) return;
      getSeasonCardStats(openid).then((stats) => {
        if (requestId !== this._seasonPointsRequestId || !stats) return;
        const value = Number(stats.points) || 0;
        this.setData({
          seasonPointsReady: true,
          seasonPoints: Number.isInteger(value) ? String(value) : value.toFixed(1),
          seasonMatches: String(Number(stats.matches) || 0),
          seasonHonorsText: formatHonors(stats.honors),
        });
      });
    },
    updateDotaCard(player) {
      const source = player || {};
      const dota2Id = String(source.dota2Id || '').trim();
      const mmr = source.mmr === null || source.mmr === undefined || source.mmr === '' ? '' : String(source.mmr);
      const rankVerified = hasCurrentRankVerification(source);
      const publicDataMissing = rankVerified && hasMissingPublicData(source);
      const rankLabel = !rankVerified
        ? '未校验段位'
        : publicDataMissing
          ? '未公开比赛数据'
          : dotaRankDisplayLabel(source, true);
      const displayText = [
        rankVerified && /^\d{5,12}$/.test(dota2Id) ? dota2Id : '',
        rankLabel,
        mmr,
      ].filter(Boolean).join(' ');
      this.setData({
        smurfWarning: this.data.allowSmurfWarning && shouldShowSmurfWarning(source, currentViewerOpenid(), rankVerified),
        dotaCard: {
          rankVerified,
          publicDataMissing,
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
