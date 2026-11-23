// A Home row in full (its "View all" tile): the hub's items as a library-style
// grid, loaded a page at a time from the hub's own key.
import { h, setText } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import { Grid } from '../ui/grid.js';
import { W, H } from '../util/screen.js';
import { pref, SPACING } from '../util/prefs.js';
import { session } from '../session.js';
import { metaLine } from '../util/format.js';
import { error } from '../util/log.js';

const PAGE = 60;

// hub: { title, key }; select(item) and menu(item) as the row had them.
export function HubScreen(hub, { select, menu, play }) {
  const el = h('div', 'screen library hub-page');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = hub.title;
  const count = h('div', 'lib-count', head);
  const focusInfo = h('div', 'lib-focus', el);
  const items = [];
  const loading = new Set();
  let alive = true;

  const cols = pref('libraryDensity') || 7;
  const gapX = SPACING[pref('gridSpacing')] || SPACING.normal;
  const w = Math.floor((W - 64 - 80 - gapX * (cols - 1)) / cols); // as in library.js
  const grid = new Grid({
    cols, kind: 'grid', size: { w, h: Math.round(w * 1.5) }, gapX, gapY: Math.round(gapX * 0.7), captionH: 70,
    top: 200, height: H - 200,
    getItem: i => items[i],
    onFocus: item => {
      if (!item) { setText(focusInfo, ''); return; }
      const name = item.type === 'episode' ? item.grandparentTitle + ' · ' + item.title
        : item.type === 'season' ? item.parentTitle + ' · ' + item.title : item.title;
      setText(focusInfo, name + '   ' + metaLine(item));
      ambience.set(item.UltraBlurColors);
    },
    onSelect: item => select(item),
    onNeed: (start, end) => {
      for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
    },
  });
  el.insertBefore(grid.el, focusInfo);

  async function loadPage(p) {
    if (loading.has(p) || (grid.total && p * PAGE >= grid.total)) return;
    loading.add(p);
    try {
      const { total, items: got } = await session.server.page(hub.key, p * PAGE, PAGE);
      if (!alive) return;
      got.forEach((m, i) => { items[p * PAGE + i] = m; });
      if (grid.total !== total) {
        grid.setTotal(total);
        setText(count, total + (total === 1 ? ' item' : ' items'));
      } else {
        grid.refresh();
      }
      if (p === 0) grid.focusIndex(grid.index);
    } catch (e) {
      loading.delete(p);
      error('hub page failed', e);
      if (!items.length) setText(count, 'Couldn\'t load this list.');
    }
  }
  loadPage(0);

  return {
    el,
    name: 'hub',
    onShow() { ambience.restore(); grid.refresh(); },
    onKey(action) {
      const item = grid.current();
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'up': if (grid.index < grid.cols) return false; grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'enter': grid.select(); return true;
        case 'play': case 'playpause': if (item && play) play(item); return true;
        case 'menu': if (item && menu) menu(item); return true;
      }
      return false;
    },
    destroy() { alive = false; },
  };
}
