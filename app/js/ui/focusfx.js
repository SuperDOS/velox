// How focus gets to the next tile (Settings → Appearance → Focus animation):
//   slide   the ring glides there (the tiles slide under it in rows)
//   fade    the ring vanishes while things move and fades in when they stop
//   bump    as fade, then the poster and ring pop up a little and settle
//   instant nothing animates; everything jumps
// slide and instant are pure CSS; fade and bump mark the row or grid as moving
// while keys keep coming, then settle a moment after the last one.
import { pref } from '../util/prefs.js';

export const FOCUS_ANIMS = { slide: 'Slide', fade: 'Fade', bump: 'Bump', instant: 'Instant' };
const SETTLE = 140; // ms after the last move: the track's ease-out is mostly there

// w: a Row or Grid ({ el, ring, focusedTile() }).
export function focusMoved(w) {
  const style = pref('focusAnim');
  if (style !== 'fade' && style !== 'bump') return;
  w.el.classList.add('moving');
  clearTimeout(w._fx);
  w._fx = setTimeout(() => {
    w.el.classList.remove('moving');
    if (style === 'bump') bump(w);
  }, SETTLE);
}

// Two identical keyframes, alternated, restart the animation without a reflow.
function bump(w) {
  const tile = w.focusedTile();
  const frame = tile && tile.frame;
  if (w._bumped && w._bumped !== frame) w._bumped.classList.remove('bump-a', 'bump-b');
  w._flip = !w._flip;
  const on = w._flip ? 'bump-a' : 'bump-b', off = w._flip ? 'bump-b' : 'bump-a';
  for (const e of [w.ring, frame]) {
    if (!e) continue;
    e.classList.remove(off);
    e.classList.add(on);
  }
  w._bumped = frame;
}
