// Critic/audience scores with source icons (Rotten Tomatoes, IMDb, TMDB),
// and a film's Oscars (from plex.tv, filled in when they arrive).
// Settings → Library → Rating logos: One colour draws the logos as plain
// shapes in the text colour (IMDb, lettering on a box, in grey instead).
import { ratings } from '../util/format.js';
import { pref } from '../util/prefs.js';
import { cachedOscars, loadOscars } from '../plex/discover.js';
import * as icons from './icons.js';

// Official logos as images (their width per unit of height); the plain star is inline SVG.
const LOGOS = { rtFresh: 0.969, rtRotten: 1.031, rtUpright: 0.75, rtSpilled: 1.344, imdb: 1.969, tmdb: 2.333 };

function logo(icon) {
  const src = 'img/ratings/' + icon + '.png';
  if (pref('ratingLogos') !== 'mono') return '<img src="' + src + '" alt="">';
  if (icon === 'imdb') return '<img class="mono" src="' + src + '" alt="">';
  return '<i class="rating-mask" style="-webkit-mask-image:url(' + src + ');width:calc(' + (24 * LOGOS[icon]).toFixed(1) + 'px * var(--ts, 1))"></i>';
}

function oscarText(o) {
  if (o.wins) return o.wins + (o.wins === 1 ? ' Oscar' : ' Oscars');
  return o.nominations + (o.nominations === 1 ? ' Oscar nomination' : ' Oscar nominations');
}

export function renderRatings(el, item) {
  const parts = ratings(item).map(r =>
    '<span class="rating rating-' + r.icon + '">' + (LOGOS[r.icon] ? logo(r.icon) : icons[r.icon]) + r.text + '</span>');
  const oscars = pref('showOscars') ? cachedOscars(item) : null;
  if (oscars) parts.push('<span class="rating rating-oscar">' + icons.statuette + oscarText(oscars) + '</span>');
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
