// A list of actions over the current screen (the item menu: hold OK on a tile).
import { h, toggleClass, setTransform } from '../util/dom.js';
import * as router from '../router.js';

// items: [{ label, icon?, run, on?, stay? }]; a null entry draws a separator.
// stay: run without closing the menu (a tick-box list); the tick then follows
// item.on.
export function showMenu({ title, subtitle, items }) {
  const el = h('div', 'menu-overlay', document.body);
  const box = h('div', 'menu-box', el);
  h('div', 'menu-title', box).textContent = title || '';
  if (subtitle) h('div', 'menu-sub', box).textContent = subtitle;
  // Long lists (filter values) scroll inside a clip.
  const clip = h('div', 'menu-clip', box);
  const track = h('div', 'menu-track', clip);
  const rows = [];
  items.forEach(it => {
    if (!it) { h('div', 'menu-sep', track); return; }
    const row = h('div', 'menu-row', track);
    if (it.icon) row.innerHTML = it.icon;
    if (it.on) row.classList.add('on');
    it.labelEl = h('span', '', row);
    it.labelEl.textContent = it.label;
    rows.push({ el: row, it });
  });
  let index = Math.max(0, items.filter(Boolean).findIndex(it => it.on));
  const render = () => {
    rows.forEach((r, i) => toggleClass(r.el, 'focus', i === index));
    const focused = rows[index] && rows[index].el;
    const room = clip.clientHeight;
    const y = focused ? Math.max(0, Math.min(focused.offsetTop + focused.offsetHeight / 2 - room / 2, track.offsetHeight - room)) : 0;
    setTransform(track, 'translateY(' + (-Math.round(y)) + 'px)');
  };
  render();

  function close() {
    router.setModal(null);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  router.setModal({
    onKey(action) {
      if (action === 'up') index = Math.max(0, index - 1);
      else if (action === 'down') index = Math.min(rows.length - 1, index + 1);
      else if (action === 'back' || action === 'menu') { close(); return; }
      else if (action === 'enter') {
        const r = rows[index];
        if (r && r.it.stay) { r.it.run(); toggleClass(r.el, 'on', !!r.it.on); return; }
        close();
        if (r) r.it.run();
        return;
      }
      render();
    },
  });
  return { close };
}

// For rows whose wording is only known after a lookup (Add/Remove Watchlist).
export function relabel(item, label) {
  item.label = label;
  if (item.labelEl) item.labelEl.textContent = label;
}
