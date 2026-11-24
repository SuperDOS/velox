// Home's top bar, in each user's own order and without what they hid:
// libraries, the pinned shelves (as one block: how many sit in the bar
// depends on the room), and the icons. Home stays first and Settings can't
// be hidden, so the bar can always get back here. Saved on this TV, per user.
import * as store from './store.js';
import { session } from '../session.js';
import { pref } from './prefs.js';

// The icons, in their usual order.
export const NAV_ICONS = [
  ['explore', 'Explore'], ['watchlist', 'Watchlist'], ['collections', 'Collections'], ['playlists', 'Playlists'],
  ['shuffle', 'Shuffle'], ['search', 'Search'], ['settings', 'Settings'],
];
export const UNHIDEABLE = { settings: 1 };

const key = () => 'topBar:' + ((session.user && session.user.uuid) || '');
let version = 0;
export const topBarVersion = () => version;

// { order: [id…], hidden: [id…] }; ids: 'section:<key>', 'shelves', or an icon's.
export function topBar() {
  const saved = store.get(key());
  if (saved) return Object.assign({ order: [], hidden: [] }, saved);
  // Before this, Explore had its own on/off setting.
  return { order: [], hidden: pref('showExplore') === false ? ['explore'] : [] };
}

export function setTopBar(t) {
  version++;
  store.set(key(), t.order.length || t.hidden.length ? t : undefined);
}

export const isHidden = id => !UNHIDEABLE[id] && topBar().hidden.indexOf(id) !== -1;

// entries: [{ navId, … }] in the default order; returns them in the user's
// order (new ones keep their place after their default neighbour), hidden
// ones left out unless keepHidden.
export function arrangeNav(entries, { keepHidden = false } = {}) {
  const { order, hidden } = topBar();
  const shown = keepHidden ? entries : entries.filter(e => UNHIDEABLE[e.navId] || hidden.indexOf(e.navId) === -1);
  if (!order.length) return shown;
  const rank = new Map();
  let last = -1;
  shown.forEach((e, i) => {
    const at = order.indexOf(e.navId);
    if (at >= 0) last = at;
    rank.set(e, at >= 0 ? at : last + (i + 1) / 1000);
  });
  return shown.slice().sort((a, b) => rank.get(a) - rank.get(b));
}
