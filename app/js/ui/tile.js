// Poster / landscape tiles. A tile node is created once and re-filled as it is
// recycled; fill() only touches the DOM for fields that changed.
import { h, setText, show, setTransform, toggleClass } from '../util/dom.js';
import { load } from './images.js';
import { session } from '../session.js';
import { progress, episodeLabel, metaLine } from '../util/format.js';
import { check } from './icons.js';
import { pref, prefsVersion } from '../util/prefs.js';

export const KINDS = {
  poster: { w: 220, h: 330 },
  wide: { w: 400, h: 225 },
  grid: { w: 216, h: 324 },
  episode: { w: 384, h: 216 },
  person: { w: 180, h: 180 },
  list: { w: 1776, h: 150 }, // library list view: a small poster, then title, details and summary
};
const LIST_POSTER = { w: 100, h: 150 };

// size overrides the kind's (library grids size tiles to fit their column count).
export function createTile(kind, { caption = false, size = KINDS[kind] } = {}) {
  const el = h('div', 'tile tile-' + kind);
  const frame = h('div', 'tile-frame', el);
  // The picture's size: the whole tile, except in a list row.
  const pic = kind === 'list' ? LIST_POSTER : size;
  frame.style.width = pic.w + 'px';
  frame.style.height = pic.h + 'px';
  const img = h('img', 'tile-img', frame);
  const ph = h('div', 'tile-ph', frame);
  img.alt = '';
  const badge = h('div', 'tile-badge', frame);
  const ep = h('div', 'tile-ep', frame);
  ep.style.display = 'none';
  const bar = h('div', 'tile-bar', frame);
  const fill = h('i', '', bar);
  let cap = null;
  let sub = null;
  let text = null;
  if (kind === 'list') {
    el.style.width = size.w + 'px';
    el.style.height = size.h + 'px';
    const body = h('div', 'tile-body', el);
    cap = h('div', 'tile-cap', body);
    sub = h('div', 'tile-sub', body);
    text = h('div', 'tile-text', body);
  } else if (caption) {
    cap = h('div', 'tile-cap', el);
    cap.style.width = size.w + 'px';
    sub = h('div', 'tile-sub', el);
    sub.style.width = size.w + 'px';
  }
  return { el, img, ph, badge, ep, bar, fill, cap, sub, text, kind, size, pic, item: null, gen: -1 };
}

function artFor(item, kind) {
  if (kind === 'wide' || kind === 'episode') {
    if (item.type === 'episode') return item.thumb || item.art;
    return item.art || item.thumb;
  }
  if (item.type === 'episode') {
    // Settings → Library → Episode artwork.
    if (pref('episodeArt') === 'season') return item.parentThumb || item.grandparentThumb || item.thumb;
    return item.grandparentThumb || item.parentThumb || item.thumb;
  }
  if (item.type === 'season') return item.thumb || item.parentThumb;
  return item.thumb;
}

function titleFor(item, kind) {
  if (item.type === 'episode' && kind !== 'episode') return item.grandparentTitle || item.title;
  return item.title;
}

function subFor(item, kind) {
  if (item.sub != null) return item.sub; // e.g. a person's role, a credit's "role · year"
  if (item.type === 'episode') {
    return kind === 'episode' ? episodeLabel(item).replace(' · ', '') + '  ' + item.title
      : episodeLabel(item) + '  ' + item.title;
  }
  if (item.type === 'season') return item.leafCount ? item.leafCount + ' episodes' : '';
  return item.year || '';
}

// An unwatched episode's own picture, when spoilers are hidden.
export function spoiler(item) {
  return item.type === 'episode' && !item.viewCount && !item.viewOffset && pref('hideSpoilers');
}

export function fillTile(tile, item) {
  // A settings change (prefsVersion) re-fills the same item.
  if (tile.item === item && tile.gen === prefsVersion()) return;
  tile.item = item;
  tile.gen = prefsVersion();
  if (!item) {
    load(tile.img, '');
    setText(tile.ph, '');
    show(tile.bar, false);
    show(tile.badge, false);
    show(tile.ep, false);
    if (tile.cap) { setText(tile.cap, ''); setText(tile.sub, ''); }
    if (tile.text) setText(tile.text, '');
    return;
  }
  const kind = tile.kind;
  const server = session.server;
  const path = artFor(item, kind);
  // The web layer is 1920x1080, so tile size is exactly the pixels we need.
  // Spoilers hidden: the server blurs the episode's own picture (free on the TV).
  const blur = path === item.thumb && spoiler(item) ? { blur: 40 } : undefined;
  load(tile.img, server ? server.image(path, tile.pic.w, tile.pic.h, blur) : '');
  setText(tile.ph, titleFor(item, kind));

  const p = progress(item);
  show(tile.bar, p > 0.01);
  if (p > 0.01) setTransform(tile.fill, 'scaleX(' + p.toFixed(3) + ')');

  // Unwatched episode count on shows/seasons, check on watched items.
  let badge = '';
  // Settings → Library → Unwatched counts / Watched marks.
  if ((item.type === 'show' || item.type === 'season') && item.leafCount) {
    const left = item.leafCount - (item.viewedLeafCount || 0);
    if (left > 0) badge = pref('showUnwatchedCount') ? String(left) : '';
    else badge = pref('showWatched') ? '✓' : '';
  } else if (item.viewCount && !item.viewOffset && item.type !== 'show') {
    badge = pref('showWatched') ? '✓' : '';
  }
  show(tile.badge, !!badge);
  if (tile.badge._v !== badge) {
    tile.badge._v = badge;
    if (badge === '✓') tile.badge.innerHTML = check;
    else setText(tile.badge, badge);
  }
  toggleClass(tile.badge, 'done', badge === '✓');

  // "S1 · E2" on episode pictures (tiles with captions already say it there).
  const epText = item.type === 'episode' && !tile.cap && pref('showEpisodeNumber') ? episodeLabel(item) : '';
  show(tile.ep, !!epText);
  setText(tile.ep, epText);

  if (kind === 'list') {
    setText(tile.cap, titleFor(item, kind));
    setText(tile.sub, item.type === 'collection' ? (item.childCount || 0) + ' items' : metaLine(item));
    setText(tile.text, spoiler(item) ? '' : item.summary || '');
  } else if (tile.cap) {
    setText(tile.cap, kind === 'episode' ? item.title : titleFor(item, kind));
    setText(tile.sub, kind === 'episode' ? episodeLabel(item) + (item.duration ? '  ·  ' + Math.round(item.duration / 60000) + 'm' : '') : subFor(item, kind));
  }
}
