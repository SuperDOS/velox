// Horizontal, virtualized row. Focus starts at the left edge and moves right
// until it reaches the middle; from there the track slides under a stationary
// focus ring, and near the end the track stops and the ring moves on to the
// last tile. Every move is compositor-only transforms; the ring never repaints.
// more: { onSelect } adds a "View all" tile after the last item.
import { h, setText, setTransform, toggleClass } from '../util/dom.js';
import { arrowRight } from './icons.js';
import { createTile, fillTile, KINDS } from './tile.js';
import { W } from '../util/screen.js';
import { magnify, magnifySpread } from './focusfx.js';

const GAP = 28;
const LEFT = 96;
const RIGHT = 96;   // the last tile stops this far from the right edge

export class Row {
  constructor({ title, kind = 'poster', size = KINDS[kind], items = [], caption = false, onFocus, onSelect, more = null }) {
    this.kind = kind;
    this.size = size; // the kind's tile size unless given (Fix match uses bigger posters)
    this.step = this.size.w + GAP;
    this.items = items;
    this.index = 0;
    this.scroll = 0;
    this.more = more;
    this.spread = magnifySpread(kind);
    this.active = false;
    this.onFocus = onFocus;
    this.onSelect = onSelect;

    this.el = h('section', 'row row-' + kind);
    this.titleEl = h('h2', 'row-title', this.el);
    setText(this.titleEl, title || '');
    const clip = h('div', 'row-clip', this.el);
    this.track = h('div', 'row-track', clip);
    this.track.style.left = LEFT + 'px';
    this.ring = h('div', 'ring', clip);
    this.ring.style.left = (LEFT - 8) + 'px';
    this.viewW = W - LEFT - RIGHT;
    this.ring.style.width = (this.size.w + 16) + 'px';
    this.ring.style.height = (this.size.h + 16) + 'px';

    this.captionH = caption ? 70 : 0;
    clip.style.height = (this.size.h + this.captionH + 24) + 'px';
    this.height = (title ? 64 : 0) + this.size.h + this.captionH + 24;

    // Enough tiles to cover the screen edge to edge, plus one on each side.
    this.poolSize = Math.ceil(W / this.step) + 3;
    this.pool = [];
    for (let i = 0; i < this.poolSize; i++) {
      const tile = createTile(kind, { caption, size });
      tile.index = -1;
      this.track.appendChild(tile.el);
      this.pool.push(tile);
    }
    if (more) {
      this.moreTile = h('div', 'tile tile-' + kind + ' tile-more', this.track);
      const frame = h('div', 'tile-frame', this.moreTile);
      frame.style.width = this.size.w + 'px';
      frame.style.height = this.size.h + 'px';
      const inner = h('div', 'more-inner', frame);
      inner.innerHTML = arrowRight;
      h('div', 'more-label', inner).textContent = 'View all';
      this.moreFx = { el: this.moreTile };
    }
    this.render();
  }

  setItems(items, keepKey) {
    this.items = items;
    if (keepKey) {
      const i = items.findIndex(it => it.ratingKey === keepKey);
      this.index = i >= 0 ? i : Math.min(this.index, this.count() - 1);
    } else {
      this.index = Math.min(this.index, Math.max(0, this.count() - 1));
    }
    for (const t of this.pool) { t.index = -1; t.item = undefined; }
    this.render();
  }

  setTitle(title) {
    setText(this.titleEl, title);
  }

  // Items plus the View all tile.
  count() {
    return this.items.length + (this.more && this.items.length ? 1 : 0);
  }

  // The focused item; null on View all.
  current() {
    return this.items[this.index] || null;
  }

  // What the page should show for the focus: on View all, the last title.
  shown() {
    return this.items[Math.min(this.index, this.items.length - 1)] || null;
  }

  onMore() {
    return !!this.more && this.index === this.items.length;
  }

  setActive(on) {
    this.active = on;
    toggleClass(this.el, 'active', on);
  }

  focusIndex(i) {
    if (!this.items.length) return;
    this.index = Math.max(0, Math.min(this.count() - 1, i));
    this.render();
    if (this.onFocus) this.onFocus(this.shown(), this);
  }

  // Returns false at the edges so the parent can decide what to do.
  move(dx) {
    const next = this.index + dx;
    if (next < 0 || next >= this.count()) return false;
    this.index = next;
    this.render();
    if (this.onFocus) this.onFocus(this.shown(), this);
    return true;
  }

  select() {
    if (this.onMore()) this.more.onSelect();
    else if (this.onSelect && this.current()) this.onSelect(this.current(), this);
  }

  render() {
    const n = this.count();
    const x = this.index * this.step;
    // Keep the focused tile in the middle, except near either end.
    const maxScroll = Math.max(0, n * this.step - GAP - this.viewW);
    const centre = Math.round((this.viewW - this.size.w) / 2);
    this.scroll = Math.max(0, Math.min(maxScroll, x - centre));
    // Tiles from the screen's left edge to its right edge.
    const first = Math.max(0, Math.floor((this.scroll - LEFT) / this.step));
    const last = Math.min(this.items.length, first + this.poolSize);
    for (let i = first; i < last; i++) {
      const tile = this.pool[i % this.poolSize];
      if (tile.index !== i) {
        tile.index = i;
        setTransform(tile.el, 'translateX(' + i * this.step + 'px)');
        tile.el.style.visibility = '';
      }
      fillTile(tile, this.items[i]);
      const d = Math.abs(i - this.index);
      magnify(tile, d <= this.spread ? d : -1);
    }
    // Slots not covering any item this frame.
    for (const tile of this.pool) {
      if (tile.index < first || tile.index >= last) {
        tile.index = -1;
        tile.el.style.visibility = 'hidden';
      }
    }
    if (this.moreTile) {
      const at = this.items.length;
      this.moreTile.style.visibility = at ? '' : 'hidden';
      setTransform(this.moreTile, 'translateX(' + at * this.step + 'px)');
      const d = Math.abs(at - this.index);
      magnify(this.moreFx, d <= this.spread ? d : -1);
    }
    setTransform(this.track, 'translateX(' + (-this.scroll) + 'px)');
    setTransform(this.ring, 'translateX(' + (x - this.scroll) + 'px)');
  }
}
