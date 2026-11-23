// The time of day at the top right, on the menu's line. Home always shows it
// (unless Settings → Appearance → Clock is off); detail and season pages too
// while "Clock on detail pages" is on.
import { h, setText } from '../util/dom.js';
import { timeOfDay, clockMode } from '../util/format.js';
import { pref } from '../util/prefs.js';

export function addClock(parent, { page = false } = {}) {
  const el = h('div', page ? 'topbar-clock page-clock' : 'topbar-clock', parent);
  const tick = () => setText(el, clockMode() === 'off' || (page && !pref('clockOnDetails')) ? '' : timeOfDay(new Date()));
  tick();
  const timer = setInterval(tick, 5000);
  return { el, tick, stop: () => clearInterval(timer) };
}
