const { DEFAULT_CARD_STYLE, normalizeCardStyle } = require('../../utils/card-style');
const { dotaRankLabel, hasCurrentRankVerification } = require('../../utils/dota-rank');

Component({
  properties: {
    player: {
      type: Object,
      value: {},
      observer(value) {
        this.updateDotaCard(value);
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
  },

  data: {
    normalizedStyle: DEFAULT_CARD_STYLE,
    dotaCard: { rankVerified: false, displayText: '', dota2Id: '', rankLabel: '', mmr: null },
  },

  methods: {
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
    },
  },
});
