// Where selecting things goes. Kept in one place so screens don't import each other.
import * as router from './router.js';
import { DetailScreen } from './screens/detail.js';
import { SeasonScreen } from './screens/season.js';
import { GenresScreen } from './screens/genres.js';
import { LibraryScreen } from './screens/library.js';
import { PlayerScreen } from './screens/player.js';
import { SearchScreen } from './screens/search.js';
import { SettingsScreen } from './screens/settings.js';
import { PersonScreen } from './screens/person.js';
import { RowsScreen } from './screens/rows.js';
import { session } from './session.js';
import { error } from './util/log.js';
import { clock, episodeLabel } from './util/format.js';
import { showMenu, relabel } from './ui/menu.js';
import { pref, shuffleShows } from './util/prefs.js';
import * as icons from './ui/icons.js';
import { discoverId, onWatchlist, setWatchlisted, watchlist } from './plex/discover.js';

const SHUFFLE_SIZE = 40;

// Removed from Continue Watching this session. Plex's hubs keep listing an
// item for a little while after the removal, so Home hides these itself
// until the server catches up.
export const removedFromContinueWatching = new Set();

export function openItem(item) {
  if (item.type === 'clip') { playItem(item); return; }
  if (item.type === 'collection') { openCollection(item); return; }
  router.push(item.type === 'season' ? SeasonScreen(item) : DetailScreen(item));
}

export function playItem(item, opts) {
  if (item.type === 'show' || item.type === 'season') {
    // Play on a show means "the next episode"; the detail screen resolves it.
    router.push(DetailScreen(item, { autoplay: true }));
    return;
  }
  router.push(PlayerScreen(item, opts || {}));
}

export function openLibrary(section) {
  router.push(LibraryScreen(section));
}

// A library's own hubs (what the official app calls Recommended).
export function openRecommended(section) {
  router.push(RowsScreen(section.title + ' · Recommended', async () => {
    const hubs = await session.server.sectionHubs(section.key);
    return hubs.map(hb => ({ title: hb.title, items: hb.Metadata }));
  }));
}

// The plex.tv Watchlist, split into what this server has and what it hasn't.
export function openWatchlist() {
  router.push(RowsScreen('Watchlist', async () => {
    const server = session.server;
    const list = (await watchlist(0, 100)).items; // plex.tv caps a page at 100
    // One lookup per item, a few at a time rather than up to 100 at once.
    const local = await mapLimit(list, 6, w =>
      server.get('/library/all', { guid: w.guid }).then(mc => (mc.Metadata || [])[0] || null, () => null));
    const mine = [];
    const missing = [];
    list.forEach((w, i) => {
      if (local[i]) mine.push(local[i]);
      else missing.push({ type: w.type, title: w.title, year: w.year, thumb: w.thumb, guid: w.guid, ratingKey: 'discover:' + w.ratingKey, sub: (w.year || '') + '  ·  not in your library', remote: true });
    });
    const removeMenu = it => {
      const id = discoverId(it);
      showMenu({ title: it.title, subtitle: 'Not in your library', items: [
        { icon: icons.bookmark, label: 'Remove from Watchlist', run: () => setWatchlisted(id, false).then(openWatchlistAgain, e => error('watchlist remove failed', e)) },
      ] });
    };
    return [
      { title: 'In your library', items: mine },
      { title: 'Not in your library', items: missing, onSelect: removeMenu, onMenu: removeMenu },
    ];
  }));
}

function openWatchlistAgain() {
  router.back();
  openWatchlist();
}

export function openGenres(section) {
  router.push(GenresScreen(section, { onPick: filter => router.replace(LibraryScreen(section, { filter })) }));
}

export function openCollections(section) {
  router.push(LibraryScreen(section, { collections: true }));
}

export function openCollection(collection, section) {
  section = section || { key: collection.librarySectionID, type: collection.subtype === 'show' ? 'show' : 'movie', title: collection.librarySectionTitle };
  router.push(LibraryScreen(section, { collection }));
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// fn over list with at most n calls in flight; results in list order.
async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

// Play movies in random order, one after another (up-next between them).
// From whole libraries the server picks at random; a collection can't be
// sorted server side, so pick random positions in it instead.
export async function shuffle({ sections = [], collection = null, total = 0, unwatched = false }) {
  const server = session.server;
  let picks = [];
  try {
    if (collection) {
      const at = shuffled(Array.from({ length: total }, (_, i) => i)).slice(0, SHUFFLE_SIZE);
      const pages = await Promise.all(at.map(i => server.collectionItems(collection.ratingKey, i, 1)));
      picks = pages.map(p => p.items[0]).filter(Boolean);
    } else {
      const lists = await Promise.all(sections.map(s =>
        server.items(s.key, 0, SHUFFLE_SIZE, { sort: 'random', type: 1, unwatched })));
      picks = shuffled([].concat.apply([], lists.map(l => l.items))).slice(0, SHUFFLE_SIZE);
    }
  } catch (e) {
    error('shuffle failed', e);
    return;
  }
  picks = picks.filter(m => m.type === 'movie' && !(unwatched && m.viewCount));
  if (picks.length) playItem(picks[0], { offset: 0, queue: picks.slice(1) });
}

// A show's or season's episodes, in order or shuffled, played back to back.
export async function playEpisodes(item, { random = false } = {}) {
  const server = session.server;
  let eps = [];
  try {
    eps = item.type === 'season' ? await server.children(item.ratingKey) : await server.allLeaves(item.ratingKey);
  } catch (e) {
    error('episodes failed', e);
    return;
  }
  eps = eps.filter(e => e.type === 'episode');
  if (random) eps = shuffled(eps);
  if (eps.length) playItem(eps[0], { offset: 0, queue: eps.slice(1) });
}

// The home Shuffle button: unwatched movies (default), all movies, or random
// episodes mixed from the shows picked in Settings.
export async function homeShuffle(movieSections) {
  const shows = shuffleShows();
  if (!shows.length) { shuffle({ sections: movieSections, unwatched: pref('homeShuffle') !== 'all' }); return; }
  let eps = [];
  try {
    const lists = await Promise.all(shows.map(s => session.server.allLeaves(s.key).catch(() => [])));
    eps = shuffled([].concat.apply([], lists).filter(e => e.type === 'episode')).slice(0, 300);
  } catch (e) {
    error('shuffle shows failed', e);
  }
  if (eps.length) playItem(eps[0], { offset: 0, queue: eps.slice(1) });
}

export function openPerson(person) {
  router.push(PersonScreen(person));
}

export function openSearch() {
  router.push(SearchScreen());
}

export function openSettings() {
  router.push(SettingsScreen());
}

// The item menu (hold OK on a tile). continueWatching: the tile is in that
// row, so it can be removed from it. onChange runs after anything that
// changes watched state or lists, so the screen can refresh.
// onPage: opened from the item's own detail page (no "Go to details").
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

function rateMenu(item, act) {
  const current = Math.round((item.userRating || 0) / 2);
  const items = [5, 4, 3, 2, 1].map(n => ({ label: stars(n), on: n === current, run: act(() => session.server.rate(item.ratingKey, n * 2)) }));
  if (current) items.push(null, { icon: icons.close, label: 'Clear rating', run: act(() => session.server.rate(item.ratingKey, -1)) });
  showMenu({ title: 'Rate', subtitle: item.title, items });
}

// The title to search for when fixing a match: the file or folder name (the
// current title is the wrong match), cleaned of year, quality and dots.
async function matchQuery(item) {
  const server = session.server;
  let path = '';
  try {
    const full = await server.metadata(item.ratingKey);
    path = item.type === 'show'
      ? ((full.Location || [])[0] || {}).path || ''
      : (((full.Media || [])[0] || {}).Part || [{}])[0].file || '';
  } catch (e) { /* fall back to the title */ }
  let name = path.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, '');
  // The last year in the name, so "1917.2019" searches for 1917 from 2019.
  const years = name.match(/\b(19|20)\d\d\b/g) || [];
  const year = years[years.length - 1];
  if (year) name = name.slice(0, name.lastIndexOf(year));
  name = name.replace(/[._]/g, ' ').replace(/[([\s-]+$/, '').replace(/\s+/g, ' ').trim();
  return { title: name || item.title, year: year || (name ? undefined : item.year) };
}

async function fixMatch(item, changed) {
  const server = session.server;
  const { title, year } = await matchQuery(item);
  let results = [];
  try {
    results = await server.matches(item.ratingKey, title, year);
  } catch (e) {
    error('match search failed', e);
  }
  const items = results.slice(0, 20).map(r => ({
    label: r.name + (r.year ? ' (' + r.year + ')' : ''), on: r.guid === item.guid,
    run: () => server.match(item.ratingKey, r).then(changed, e => error('fix match failed', e)),
  }));
  showMenu({
    title: 'Fix match', subtitle: 'Searched for “' + title + (year ? ' ' + year : '') + '”',
    items: items.length ? items : [{ label: 'No matches found', run: () => {} }],
  });
}

export function itemMenu(item, { continueWatching = false, onPage = false, onChange } = {}) {
  if (!item || item.remote || item.type === 'person' || item.type === 'collection') return;
  const server = session.server;
  const changed = () => { server.invalidate(); if (onChange) onChange(); };
  const act = fn => () => fn().then(changed, e => error('item action failed', e));
  const playable = item.type === 'movie' || item.type === 'episode';
  const nav = [];
  const state = [];

  if (playable && item.viewOffset) nav.push({ icon: icons.play, label: 'Resume from ' + clock(item.viewOffset), run: () => playItem(item, { offset: item.viewOffset }) });
  if (playable) nav.push({ icon: icons.restart, label: 'Play from start', run: () => playItem(item, { offset: 0 }) });
  if (!onPage) nav.push({ icon: icons.info, label: item.type === 'episode' ? 'Go to episode' : item.type === 'season' ? 'Go to season' : 'Go to details', run: () => openItem(item) });
  if (item.type === 'show' || item.type === 'season') {
    const what = item.type === 'show' ? 'all' : 'season';
    nav.push({ icon: icons.play, label: 'Play ' + what, run: () => playEpisodes(item) });
    nav.push({ icon: icons.shuffle, label: 'Shuffle ' + (item.type === 'show' ? 'show' : 'season'), run: () => playEpisodes(item, { random: true }) });
  }
  if (item.type === 'episode' || item.type === 'season') {
    const show = item.type === 'episode' ? item.grandparentRatingKey : item.parentRatingKey;
    const title = item.type === 'episode' ? item.grandparentTitle : item.parentTitle;
    if (show) nav.push({ icon: icons.tv, label: 'Go to show', run: () => router.push(DetailScreen({ ratingKey: show, type: 'show', title })) });
  }

  const showLike = item.type === 'show' || item.type === 'season';
  const watched = showLike ? item.leafCount && item.viewedLeafCount >= item.leafCount : !!item.viewCount && !item.viewOffset;
  state.push(watched
    ? { icon: icons.uncheck, label: 'Mark as unwatched', run: act(() => server.unscrobble(item.ratingKey)) }
    : { icon: icons.check, label: 'Mark as watched', run: act(() => server.scrobble(item.ratingKey)) });
  if (item.type === 'episode' && item.parentRatingKey) {
    state.push({ icon: icons.check, label: 'Mark season as watched', run: act(() => server.scrobble(item.parentRatingKey)) });
  }
  if (continueWatching) {
    state.push({ icon: icons.close, label: 'Remove from Continue Watching', run: act(() => {
      removedFromContinueWatching.add(item.ratingKey);
      return server.removeFromContinueWatching(item.ratingKey);
    }) });
  }
  if (item.type !== 'season') {
    state.push({ icon: icons.star, label: item.userRating ? 'Your rating: ' + stars(item.userRating / 2) : 'Rate…', run: () => rateMenu(item, act) });
  }
  if (item.type === 'movie' || item.type === 'show') {
    state.push({ icon: icons.search, label: 'Fix match…', run: () => fixMatch(item, changed) });
  }
  // Open at once; the watchlist row says Add until plex.tv answers (Add is
  // idempotent, so acting on it early is harmless).
  const id = discoverId(item);
  const what = item.type === 'episode' || item.type === 'season' ? 'show ' : '';
  let on = false;
  const wl = id && { icon: icons.bookmark, label: 'Add ' + what + 'to Watchlist', run: act(() => setWatchlisted(id, !on)) };
  if (wl) state.push(wl);
  const title = item.type === 'episode' ? item.grandparentTitle : item.title;
  const sub = item.type === 'episode' ? episodeLabel(item) + '  ' + item.title : item.type === 'season' ? item.title : item.year || '';
  showMenu({ title, subtitle: sub, items: nav.concat([null], state) });
  if (wl) {
    onWatchlist(id).then(yes => {
      on = yes;
      if (on) relabel(wl, 'Remove ' + what + 'from Watchlist');
    }, () => {});
  }
}
