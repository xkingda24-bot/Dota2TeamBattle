// components/tournament-flow/index.js - 比赛阶段流程导航
const STEPS = [
  { key: 'registration', number: 1, label: '报名' },
  { key: 'draft', number: 2, label: '选人/分组' },
  { key: 'battle', number: 3, label: '对战' },
  { key: 'settlement', number: 4, label: '最后结算' },
];

function stageIndex(tournament, current, settlementReady) {
  const value = current || (tournament && tournament.status) || 'registration';
  if (value === 'settlement') return 3;
  if (value === 'finished') return settlementReady ? 3 : 2;
  if (value === 'battle') return 2;
  if (value === 'draft') return 1;
  return 0;
}

function stageName(tournament, settlementReady) {
  const index = stageIndex(tournament, '', settlementReady);
  return STEPS[index].key;
}

Component({
  properties: {
    tournament: {
      type: Object,
      value: null,
      observer() {
        this.refreshSteps();
      },
    },
    current: {
      type: String,
      value: '',
      observer() {
        this.refreshSteps();
      },
    },
    displayStage: {
      type: String,
      value: '',
      observer() {
        this.refreshSteps();
      },
    },
    readonly: {
      type: Boolean,
      value: false,
      observer() {
        this.refreshSteps();
      },
    },
    settlementReady: {
      type: Boolean,
      value: false,
      observer() {
        this.refreshSteps();
      },
    },
  },

  data: {
    steps: [],
  },

  lifetimes: {
    attached() {
      this.refreshSteps();
    },
  },

  methods: {
    refreshSteps() {
      const tournament = this.properties.tournament || {};
      const activeIndex = stageIndex(tournament, this.properties.current, this.properties.settlementReady);
      const displayIndex = stageIndex(tournament, this.properties.displayStage || this.properties.current, this.properties.settlementReady);
      const labels = STEPS.map((step) => (
        step.key === 'draft' && tournament.mode === 'auto' ? '分组' : step.label
      ));
      const steps = STEPS.map((step, index) => ({
        key: step.key,
        number: step.number,
        label: labels[index],
        state: index === displayIndex ? 'active' : index <= activeIndex ? 'done' : 'locked',
        lineState: index < activeIndex ? 'line-done' : 'line-locked',
        clickable: index <= activeIndex,
      }));
      this.setData({ steps });
    },

    onStepTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      const tournament = this.properties.tournament || {};
      const activeIndex = stageIndex(tournament, this.properties.current, this.properties.settlementReady);
      if (!tournament.id || !Number.isFinite(index) || index < 0 || index > activeIndex) return;
      if (index === 3 && !this.properties.settlementReady) {
        wx.showToast({ title: '结算尚未完成', icon: 'none' });
        return;
      }

      const pages = getCurrentPages();
      const currentRoute = pages.length ? pages[pages.length - 1].route : '';
      const id = encodeURIComponent(tournament.id);
      const returningToLiveBattle = tournament.status === 'battle' && index === activeIndex;
      const targetReadonly = index < activeIndex || (this.properties.readonly && !returningToLiveBattle);
      const draftAnchor = tournament.mode === 'auto' && tournament.status === 'draft' &&
        tournament.isAdmin && !this.properties.readonly
        ? 'team-stage-edit-anchor'
        : 'team-stage-anchor';

      let url = '/pages/bracket/bracket?id=' + id;
      if (index === 0) {
        url = '/pages/register/register?id=' + id;
      } else if (index === 1 && tournament.mode !== 'auto' &&
        (tournament.status === 'draft' || tournament.status === 'battle')) {
        url = '/pages/draft/draft?id=' + id;
      }
      if (targetReadonly) url += '&readonly=1';
      const targetRoute = url.split('?')[0].replace(/^\//, '');
      const currentView = this.properties.displayStage || stageName(tournament, this.properties.settlementReady);
      const targetView = index === 0 ? 'registration' : index === 1 ? 'draft' : index === 2 ? 'battle' : 'settlement';
      const sameRouteView = currentRoute !== 'pages/bracket/bracket' || currentView === targetView ||
        (targetView === 'battle' && currentView === tournament.status);
      if (currentRoute === targetRoute && sameRouteView) {
        if (index === 0) {
          wx.pageScrollTo({ scrollTop: 0, duration: 300 });
        } else if (index === 1 && currentRoute === 'pages/draft/draft') {
          wx.pageScrollTo({ scrollTop: 0, duration: 300 });
        } else if (index === 1 && currentRoute === 'pages/bracket/bracket') {
          wx.pageScrollTo({ selector: '#' + draftAnchor, duration: 300 });
        } else if (index === 2 && currentRoute === 'pages/bracket/bracket') {
          wx.pageScrollTo({ selector: '#battle-stage-anchor', duration: 300 });
        } else if (index === 3 && currentRoute === 'pages/bracket/bracket') {
          if (tournament.status === 'finished' && this.properties.settlementReady) {
            wx.pageScrollTo({ selector: '#settlement-anchor', duration: 300 });
          } else {
            wx.showToast({ title: '结算尚未完成', icon: 'none' });
          }
        }
        return;
      }
      if (targetRoute === 'pages/bracket/bracket') {
        const anchor = index === 1
          ? draftAnchor
          : index === 2
            ? 'battle-stage-anchor'
            : index === 3
              ? 'settlement-anchor'
              : '';
        if (anchor) url += '&anchor=' + anchor;
        url += '&view=' + targetView;
      } else {
        url += '&stage=' + targetView;
      }
      wx.redirectTo({ url });
    },
  },
});
