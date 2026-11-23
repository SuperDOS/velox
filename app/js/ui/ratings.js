// Critic/audience scores with source icons (Rotten Tomatoes, IMDb, TMDB),
// and a film's Oscars (from plex.tv, filled in when they arrive).
// Settings → Library → Rating logos: One colour shows them in grey.
import { ratings } from '../util/format.js';
import { pref } from '../util/prefs.js';
import { cachedOscars, loadOscars } from '../plex/discover.js';
import * as icons from './icons.js';

// Official logos as images; the plain star is inline SVG. One colour keeps
// each logo's detail (the tomato's leaf, the popcorn's stripes) in grey.
const LOGOS = { rtFresh: 1, rtRotten: 1, rtUpright: 1, rtSpilled: 1, imdb: 1, tmdb: 1 };

function logo(icon) {
  return '<img' + (pref('ratingLogos') === 'mono' ? ' class="mono"' : '') + ' src="img/ratings/' + icon + '.png" alt="">';
}

// "×4" for wins; a film only nominated shows its nominations, "4 nom.".
function oscarText(o) {
  return o.wins ? '×' + o.wins : o.nominations + ' nom.';
}

export function renderRatings(el, item) {
  const parts = ratings(item).map(r =>
    '<span class="rating rating-' + r.icon + '">' + (LOGOS[r.icon] ? logo(r.icon) : icons[r.icon]) + r.text + '</span>');
  const oscars = pref('showOscars') ? cachedOscars(item) : null;
  if (oscars) parts.push('<span class="rating rating-oscar" title="Oscars">' + icons.statuette + oscarText(oscars) + '</span>');
  const html = parts.join('');
  el._item = item;
  // Skip the write when nothing changed; hero/focus updates call this often.
  if (el._html !== html) {
    el._html = html;
    el.innerHTML = html;
  }
  // Not asked yet: ask, and redraw if this item is still the one shown.
  if (oscars === undefined) loadOscars(item).then(o => { if (o && el._item === item) renderRatings(el, item); });
}
