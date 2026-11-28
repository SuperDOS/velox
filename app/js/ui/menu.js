// A list of actions over the current screen (the item menu: hold OK on a tile).
import { h, toggleClass, setTransform } from '../util/dom.js';
import * as router from '../router.js';

// items: [{ label, icon?, run, on?, stay?, adjust?, className?, font? }]; a null entry draws a separator.
// font: the label in that font-family (a font list).
// className: extra classes on the row (menu-nested: indented under the row above).
// stay: run without closing the menu (a tick-box list); the tick then follows
// item.on. adjust(dir): ◀▶ change the row's value in place (relabel() it).
// onClose runs however the menu closes. start: the row focused first when no
// row is on (rows counted without separators). focus: the row focused first
// whatever is on. anchor: an element (a toolbar button) to open just under,
// instead of at the right edge.
// oneLine: long labels end in "…" instead of wrapping (a list of names).
export function showMenu({ title, subtitle, items, onClose, start = 0, focus = null, anchor = null, oneLine = false }) {
  const el = h('div', 'menu-overlay', document.body);
  const box = h('div', 'menu-box' + (oneLine ? ' menu-oneline' : ''), el);
  h('div', 'menu-title', box).textContent = title || '';
  const subEl = subtitle != null ? h('div', 'menu-sub', box) : null;
  if (subEl) subEl.textContent = subtitle;
  // Long lists (filter values) scroll inside a clip.
  const clip = h('div', 'menu-clip', box);
  const track = h('div', 'menu-track', clip);
  const rows = [];
  items.forEach(it => {
    if (!it) { h('div', 'menu-sep', track); return; }
    const row = h('div', 'menu-row', track);
    if (it.icon) row.innerHTML = it.icon;
    if (it.on) row.classList.add('on');
    if (it.adjust) row.classList.add('menu-adjust');
    if (it.className) row.className += ' ' + it.className;
    it.labelEl = h('span', '', row);
    it.labelEl.textContent = it.label;
    if (it.font) it.labelEl.style.fontFamily = it.font;
    rows.push({ el: row, it });
  });
  if (anchor) placeUnder(el, box, anchor);
  const on = items.filter(Boolean).findIndex(it => it.on);
  let index = focus != null ? focus : on >= 0 ? on : start;
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
    if (onClose) onClose();
  }

  router.setModal({
    onKey(action) {
      if (action === 'up') index = Math.max(0, index - 1);
      else if (action === 'down') index = Math.min(rows.length - 1, index + 1);
      else if (action === 'back' || action === 'menu') { close(); return; }
      else if ((action === 'left' || action === 'right') && rows[index] && rows[index].it.adjust) {
        rows[index].it.adjust(action === 'left' ? -1 : 1);
        return;
      }
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
  // setSubtitle: for a line that's only known later (a count).
  return { close, setSubtitle: text => { if (subEl) subEl.textContent = text; } };
}

// Top just below the anchor, lined up with its left edge (on the left half
// of the screen) or its right edge (page units: the overlay is scaled with
// the interface size).
function placeUnder(overlay, box, anchor) {
  const o = overlay.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  if (!o.width || !a.width) return;
  const k = overlay.offsetWidth / o.width;
  const top = (a.bottom - o.top) * k + 16;
  box.style.transform = 'none';
  if ((a.left + a.right) / 2 - o.left < o.width / 2) {
    box.style.right = 'auto';
    box.style.left = Math.max(40, Math.round((a.left - o.left) * k)) + 'px';
  } else {
    box.style.right = Math.max(40, Math.round(overlay.offsetWidth - (a.right - o.left) * k)) + 'px';
  }
  box.style.top = Math.round(Math.min(top, overlay.offsetHeight - box.offsetHeight - 40)) + 'px';
}

// For rows whose wording is only known after a lookup (Add/Remove Watchlist).
export function relabel(item, label) {
  item.label = label;
  if (item.labelEl) item.labelEl.textContent = label;
}

// One line of text (Samsung's on-screen keyboard comes up on focus).
// Resolves with the text, or null when cancelled with Back.
const IME_DONE = 65376;
const IME_CANCEL = 65385;
// secret: a PIN (hidden digits, the TV's number keypad).
export function showPrompt({ title, value = '', placeholder = '', secret = false }) {
  return new Promise(resolve => {
    const el = h('div', 'menu-overlay', document.body);
    const box = h('div', 'menu-box prompt-box', el);
    h('div', 'menu-title', box).textContent = title || '';
    const input = h('input', 'prompt-input', box);
    input.value = value;
    input.placeholder = placeholder;
    if (secret) {
      // A number field brings up the TV's number keyboard (it ignores
      // inputmode on a password field); the digits are drawn as dots instead.
      input.type = 'number';
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('pattern', '[0-9]*');
      input.style.webkitTextSecurity = 'disc';
      input.classList.add('prompt-pin');
    }
    h('div', 'menu-sub', box).textContent = 'OK to apply · Back to cancel';
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      input.blur();
      router.setModal(null);
      if (el.parentNode) el.parentNode.removeChild(el);
      resolve(v);
    };
    input.addEventListener('keydown', e => {
      if (e.keyCode === IME_DONE) finish(input.value.trim());
      else if (e.keyCode === IME_CANCEL) finish(null);
    });
    // Plex PINs are four digits: the fourth one answers.
    if (secret) input.addEventListener('input', () => { if (/^\d{4}$/.test(input.value)) finish(input.value); });
    router.setModal({
      onKey(action) {
        if (action === 'enter') finish(input.value.trim());
        else if (action === 'back') finish(null);
        else if (action === 'down' || action === 'up') input.focus();
      },
    });
    setTimeout(() => input.focus(), 50);
  });
}
