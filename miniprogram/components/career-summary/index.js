// components/career-summary - 「我的」页生涯摘要卡：核心数据 + 最近战绩 + 最佳搭档。
// 数据由页面取好（buildCareerView + summarizeCareer），组件只负责展示与转发跳转。
Component({
  properties: {
    career: { type: Object, value: null },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },
  methods: {
    onMore() {
      this.triggerEvent('more');
    },
    onRetry() {
      this.triggerEvent('retry');
    },
    onPlacement(event) {
      const id = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
      if (id) this.triggerEvent('placement', { id });
    },
  },
});
