// How focus gets to the next tile (Settings → Appearance → Focus animation):
//   slide    the ring glides there (the tiles slide under it in rows)
//   fade     the ring vanishes while things move and fades in when they stop
//   magnify  like the macOS Dock: the focused poster grows, and the two on
//            each side a little less, and the ring fades in as with fade
//   instant  nothing animates; everything jumps
// Also here: Dim other tiles, and Focus border off (with Magnify or Dim, the
// focused tile stands out without the ring, Apple TV style).
// slide and instant are pure CSS. fade and magnify mark the row or grid as
// moving while keys keep coming and settle a moment after the last one;
// magnify's sizes come from the mag0/1/2 classes rows and grids put on tiles.
import { pref } from '../util/prefs.js';
import { toggleClass } from '../util/dom.js';

export const FOCUS_ANIMS = { slide: 'Slide', fade: 'Fade', magnify: 'Magnify', instant: 'Instant' };
const SETTLE = 140; // ms after the last move: the track's ease-out is mostly there

// w: a Row or Grid ({ el }).
export function focusMoved(w) {
  const style = pref('focusAnim');
  if (style !== 'fade' && style !== 'magnify') return;
  w.el.classList.add('moving');
  clearTimeout(w._fx);
  w._fx = setTimeout(() => w.el.classList.remove('moving'), SETTLE);
}

// Thumbnails (episode pictures, wide art) magnify only the focused one: few fit
// on screen, so spreading would set every tile moving.
export function magnifySpread(kind) {
  return kind === 'wide' || kind === 'episode' || kind === 'list' ? 0 : 2;
}

// level: steps from the focused tile (0 is it); past the spread, normal size.
export function magnify(tile, level) {
  if (tile._mag === level) return;
  tile._mag = level;
  toggleClass(tile.el, 'mag0', level === 0);
  toggleClass(tile.el, 'mag1', level === 1);
  toggleClass(tile.el, 'mag2', level === 2);
}
