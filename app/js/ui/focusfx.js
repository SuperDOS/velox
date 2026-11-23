// How focus shows on tiles (Settings → Appearance → Focus style):
//   slide      the border glides to the next tile (in rows the tiles slide under it)
//   spotlight  the border, and the rest of the row or grid in use dimmed
//   magnify    no border: the focused poster grows, the two on each side a
//              little less (like the macOS Dock), and the rest is dimmed
// Focus animation off makes every style jump instead (for TVs that struggle).
// All of it is CSS keyed on classes: focus-*, dim-others, no-anim on <html> (prefs.js), and mag0/1/2
// on tiles, which rows and grids set by distance from the focused one.
import { toggleClass } from '../util/dom.js';

export const FOCUS_STYLES = { slide: 'Border', spotlight: 'Spotlight', magnify: 'Magnify' };

// Thumbnails (episode pictures, wide art) and list rows mark only the focused
// one: few fit on screen, so spreading would set every tile moving.
export function magnifySpread(kind) {
  return kind === 'wide' || kind === 'episode' || kind === 'list' ? 0 : 2;
}

// level: steps from the focused tile (0 is it); past the spread, -1.
export function magnify(tile, level) {
  if (tile._mag === level) return;
  tile._mag = level;
  toggleClass(tile.el, 'mag0', level === 0);
  toggleClass(tile.el, 'mag1', level === 1);
  toggleClass(tile.el, 'mag2', level === 2);
}
