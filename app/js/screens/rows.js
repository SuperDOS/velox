// A titled page of rows, e.g. a library's Recommended page (its own hubs).
import { h, setText, setTransform, fitText } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import { Row } from '../ui/row.js';
import { openItem, playItem, itemMenu } from '../nav.js';
import { error } from '../util/log.js';

const TOP = 200;

// load(): Promise<[{ title, items, wide?, onSelect?, onMenu? }]>
export function RowsScreen(title, load) {
  const el = h('div', 'screen rows-page');
  const ambience = useAmbience();
  const titleEl = h('h1', 'lib-title rows-title', el);
  titleEl.textContent = title;
  const status = h('div', 'rows-status', el);
  const clip = h('div', 'rows-clip', el);
  clip.style.top = TOP + 'px';
  const body = h('div', 'rows-body', clip);
  let rows = [];
  let rowIndex = 0;
  let alive = true;

  function render() {
    rows.forEach((r, i) => r.setActive(i === rowIndex));
    const row = rows[rowIndex];
    setTransform(body, 'translateY(' + (row && rowIndex > 0 ? -row.top : 0) + 'px)');
  }

  load().then(groups => {
    if (!alive) return;
    let y = 0;
    groups.filter(g => g.items.length).forEach(g => {
      const row = new Row({
        title: g.title, kind: g.wide ? 'wide' : 'poster', caption: true, items: g.items,
        onFocus: it => it && ambience.set(it.UltraBlurColors), onSelect: g.onSelect || openItem,
      });
      row.onMenu = g.onMenu || (it => itemMenu(it));
      row.top = y;
      row.el.style.top = y + 'px';
      y += row.height + 20;
      body.appendChild(row.el);
      rows.push(row);
    });
    setText(status, rows.length ? '' : 'Nothing here.');
    render();
  }, e => {
    error('rows page failed', e);
    setText(status, 'Couldn\'t load this page.');
  });

  return {
    el,
    name: 'rows',
    onShow() { ambience.restore(); fitText(titleEl, 58, 36); },
    onKey(action) {
      const row = rows[rowIndex];
      if (!row) return false;
      switch (action) {
        case 'up': if (rowIndex > 0) { rowIndex--; render(); } return true;
        case 'down': if (rowIndex < rows.length - 1) { rowIndex++; render(); } return true;
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': if (row.current()) playItem(row.current()); return true;
        case 'menu': if (row.current()) row.onMenu(row.current()); return true;
        case 'back':
          if (rowIndex > 0 || row.index > 0) { rowIndex = 0; rows.forEach(r => r.focusIndex(0)); render(); return true; }
          return false;
      }
      return false;
    },
    destroy() { alive = false; },
  };
}
