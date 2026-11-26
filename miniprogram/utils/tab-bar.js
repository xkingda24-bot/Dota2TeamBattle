function selectTabBar(page, selected) {
  if (!page || typeof page.getTabBar !== 'function') return;
  const tabBar = page.getTabBar();
  if (tabBar && typeof tabBar.setData === 'function') tabBar.setData({ selected });
}

module.exports = { selectTabBar };
