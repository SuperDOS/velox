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
import { HubScreen } from './screens/hub.js';
import { isAdmin } from './homeUsers.js';
import { session } from './session.js';
import { error } from './util/log.js';
import { clock, episodeLabel, duration } from './util/format.js';
import { showMenu, relabel } from './ui/menu.js';
import { pref, shuffleShows } from './util/prefs.js';
import * as icons from './ui/icons.js';
import { showFileInfo } from './ui/fileinfo.js';
import { showFixMatch } from './ui/fixmatch.js';
import { discoverId, onWatchlist, setWatchlisted, watchlist, exploreHubs } from './plex/discover.js';
import { shelfFor, pinShelf, unpinShelf, forgetShelf, setShelfOnHome, renameShelf, inBar, onHome } from './util/shelves.js';
import { showPrompt } from './ui/menu.js';
import { editSmartCollection } from './ui/smartedit.js';

const SHUFFLE_SIZE = 40;

// Removed from Continue Watching this session. Plex's hubs keep listing an
// item for a little while after the removal, so Home hides these itself
// until the server catches up.
export const removedFromContinueWatching = new Set();

export function openItem(item) {
  if (item.type === 'clip') { playItem(item); return; }
  if (item.type === 'collection') { openCollection(item); return; }
  if (item.type === 'playlist') { openPlaylist(item); return; }
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

// OK on an episode tile (Settings → Home → Episode action): play it, or open
// its page. Used by Home, the show page's episode row and season grids.
export function selectEpisode(ep) {
  if (pref('episodeAction') === 'play') playItem(ep, { offset: ep.viewOffset || 0 });
  else openItem(ep);
}

export function openLibrary(section) {
  router.push(LibraryScreen(section));
}

// A row's View all: the whole hub as a grid.
export function openHub(hub, actions) {
  router.push(HubScreen(hub, actions));
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

// Explore: Plex Discover's suggestion rows. A title on this server opens (or
// plays) as usual; one that isn't offers the Watchlist.
const localByGuid = new Map();
function findLocal(it) {
  if (!localByGuid.has(it.guid)) {
    localByGuid.set(it.guid, session.server.get('/library/all', { guid: it.guid })
      .then(mc => (mc.Metadata || [])[0] || null, () => null));
  }
  return localByGuid.get(it.guid);
}

function remoteItem(w) {
  const kind = w.type === 'show' ? 'Show' : 'Movie';
  return { type: w.type, title: w.title, year: w.year, thumb: w.thumb, guid: w.guid, summary: w.summary,
    ratingKey: 'discover:' + w.ratingKey, sub: [w.year, kind].filter(Boolean).join('  ·  '), remote: true };
}

async function openRemote(it) {
  const local = await findLocal(it);
  if (local) { openItem(local); return; }
  const id = discoverId(it);
  let on = false;
  const wl = {
    icon: icons.bookmark, label: 'Add to Watchlist',
    run: () => setWatchlisted(id, !on).catch(e => error('watchlist failed', e)),
  };
  showMenu({ title: it.title, subtitle: (it.sub ? it.sub + '  ·  ' : '') + 'not in your library', items: id ? [wl] : [{ label: 'Nothing to do here', run: () => {} }] });
  if (id) onWatchlist(id).then(v => { on = v; relabel(wl, v ? 'Remove from Watchlist' : 'Add to Watchlist'); }, () => {});
}

async function playRemote(it) {
  const local = await findLocal(it);
  if (local) playItem(local); else openRemote(it);
}

export function openExplore() {
  localByGuid.clear(); // the library may have changed since
  router.push(RowsScreen('Explore', async () => {
    const hubs = await exploreHubs(20);
    return hubs.map(hb => ({ title: hb.title, items: hb.items.map(remoteItem), onSelect: openRemote, onMenu: openRemote, onPlay: playRemote }));
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

// Home's Collections entry: one library's collections as its grid, or with
// several, a row for each library.
export function openAllCollections(sections) {
  if (sections.length === 1) { openCollections(sections[0]); return; }
  router.push(RowsScreen('Collections', async () => {
    const lists = await Promise.all(sections.map(s => session.server.collections(s.key, 0, 100).catch(() => ({ items: [] }))));
    return sections.map((s, i) => ({
      title: s.title,
      items: lists[i].items.map(c => Object.assign({ librarySectionID: s.key }, c)),
      onMenu: c => shelfMenu(c),
    }));
  }));
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

// --- Playlists and shelves -------------------------------------------------

const PLAYLIST_MAX = 500;
const playlistKey = pl => '/playlists/' + pl.ratingKey + '/items';

// The user's video playlists as a grid; OK opens one, Play plays it.
export function openPlaylists() {
  router.push(HubScreen({ title: 'Playlists', key: '/playlists?playlistType=video' }, {
    select: openPlaylist,
    play: pl => playPlaylist(pl),
    menu: (pl, reload) => shelfMenu(pl, { onChange: reload }),
  }));
}

// One playlist: its items in order, with Play and Shuffle above the grid.
export function openPlaylist(pl) {
  pl = Object.assign({ type: 'playlist' }, pl); // from a shelf: just its key and title
  const menu = (item, reload) => itemMenu(item, { playlist: pl, onChange: reload });
  router.push(HubScreen({ title: pl.title, key: playlistKey(pl) }, {
    select: item => (item.type === 'episode' ? selectEpisode(item) : openItem(item)),
    menu,
    play: item => playPlaylist(pl, { from: item }),
    tools: [
      { icon: icons.play, label: 'Play', run: () => playPlaylist(pl) },
      { icon: icons.shuffle, label: 'Shuffle', run: () => playPlaylist(pl, { random: true }) },
      { icon: icons.bookmark, label: () => (inBar(pl.ratingKey) || onHome(pl.ratingKey) ? 'Pinned' : 'Pin'),
        run: ({ refresh, el }) => shelfMenu(pl, { onPage: true, anchor: el, onChange: refresh }) },
    ],
  }));
}

// A whole playlist back to back (from one item on, or shuffled).
export async function playPlaylist(pl, { random = false, from = null } = {}) {
  let list = [];
  try {
    list = (await session.server.page(playlistKey(pl), 0, PLAYLIST_MAX)).items;
  } catch (e) {
    error('playlist failed', e);
    return;
  }
  list = list.filter(m => m.type === 'movie' || m.type === 'episode' || m.type === 'clip');
  if (from) list = list.slice(Math.max(0, list.findIndex(m => m.playlistItemID === from.playlistItemID)));
  if (random) list = shuffled(list);
  if (list.length) playItem(list[0], { offset: from ? from.viewOffset || 0 : 0, queue: list.slice(1) });
}

// A pinned shelf from Home's top bar: a collection opens like a library's
// collection, a playlist as above.
export function openShelf(shelf) {
  if (shelf.kind === 'playlist') openPlaylist({ ratingKey: shelf.ratingKey, title: shelf.title });
  else openCollection({ ratingKey: shelf.ratingKey, title: shelf.title, librarySectionID: shelf.sectionKey, subtype: shelf.sectionType });
}

// Hold OK on a collection or playlist: for this user, pin it in Home's top
// bar and/or show it as a Home row (each on its own). onPage: from the
// playlist's own page, which has Play and Shuffle buttons already.
export function shelfMenu(item, { onChange, onPage = false, anchor = null } = {}) {
  const pinned = shelfFor(item.ratingKey);
  const bar = inBar(item.ratingKey);
  const row = onHome(item.ratingKey);
  const done = () => { if (onChange) onChange(); };
  const items = [];
  if (!onPage && (item.type === 'playlist' || (pinned && pinned.kind === 'playlist'))) {
    items.push({ icon: icons.play, label: 'Play', run: () => playPlaylist(item) });
    items.push({ icon: icons.shuffle, label: 'Shuffle', run: () => playPlaylist(item, { random: true }) });
    items.push(null);
  }
  items.push(bar
    ? { icon: icons.close, label: 'Remove from the top bar', run: () => { unpinShelf(item.ratingKey); done(); } }
    : { icon: icons.bookmark, label: 'Pin in the top bar', run: () => { pinShelf(item); done(); } });
  items.push(row
    ? { icon: icons.close, label: 'Remove row from Home', run: () => { setShelfOnHome(item, false); done(); } }
    : { icon: icons.home, label: 'Show as a Home row', run: () => { setShelfOnHome(item, true); done(); } });
  const what = (item.type || (pinned && pinned.kind)) === 'playlist' ? 'Playlist' : 'Collection';
  // Admins: rename or delete a collection (for everyone; not a playlist,
  // which is this user's own and edited in Plex).
  if (what === 'Collection' && isAdmin()) {
    items.push(null);
    if (item.smart) items.push({ icon: icons.filter, label: 'Edit rules…', run: () => editSmartCollection({ collection: item, onDone: done }) });
    items.push({ icon: icons.sort, label: 'Rename collection…', run: () => renameCollectionPrompt(item, done) });
    items.push({ icon: icons.close, label: 'Delete collection…', run: () => deleteCollectionConfirm(item, done) });
  }
  const where = [bar ? 'in the top bar' : '', row ? 'a Home row' : ''].filter(Boolean).join(' and ');
  showMenu({ title: item.title, subtitle: what + (pinned && where ? ' · ' + where + ' for ' + who() : ' · for ' + who()), items, anchor });
}

const who = () => (session.user && session.user.title) || 'this user';

// --- Collections (admins; they change the library for everyone) --------------

async function sectionOf(item) {
  if (item.librarySectionID) return String(item.librarySectionID);
  const full = await session.server.metadata(item.ratingKey).catch(() => null);
  return full && full.librarySectionID ? String(full.librarySectionID) : null;
}

async function renameCollectionPrompt(col, done) {
  const title = await showPrompt({ title: 'Rename collection', value: col.title, placeholder: 'Collection name' });
  if (!title || !title.trim() || title.trim() === col.title) return;
  const server = session.server;
  try {
    const sec = await sectionOf(col);
    await server.renameCollection(sec, col.ratingKey, title.trim());
    renameShelf(col.ratingKey, title.trim());
    server.invalidate();
    done();
  } catch (e) {
    error('rename collection failed', e);
    // 409: the name is taken (Plex keeps a deleted collection's for a while too).
    showMenu({ title: e.status === 409 ? 'That name is taken' : 'Couldn\'t rename it',
      subtitle: e.status === 409 ? 'There\'s already a collection called “' + title.trim() + '”. Try another name.' : e.message,
      items: [{ icon: icons.check, label: 'OK', run: () => {} }] });
  }
}

function deleteCollectionConfirm(col, done) {
  showMenu({ title: 'Delete “' + col.title + '”?', subtitle: 'For everyone on this server. The movies and shows in it stay.', items: [
    { icon: icons.close, label: 'Delete collection', run: () => session.server.deleteCollection(col.ratingKey).then(() => {
      forgetShelf(col.ratingKey);
      session.server.invalidate();
      done();
    }, e => error('delete collection failed', e)) },
    { icon: icons.restart, label: 'Keep it', run: () => {} },
  ], start: 1 });
}

// What a collection can hold: movies and shows. An episode or season adds
// its show.
export function collectionTarget(item) {
  if (item.type === 'movie' || item.type === 'show') return item;
  if (item.type === 'episode' && item.grandparentRatingKey) {
    return { ratingKey: item.grandparentRatingKey, title: item.grandparentTitle, type: 'show', librarySectionID: item.librarySectionID };
  }
  if (item.type === 'season' && item.parentRatingKey) {
    return { ratingKey: item.parentRatingKey, title: item.parentTitle, type: 'show', librarySectionID: item.librarySectionID };
  }
  return null;
}

// Item menu → Add to collection: this library's collections (not smart
// ones, which fill themselves), or a new one.
export async function addToCollectionMenu(item, changed = () => {}) {
  const server = session.server;
  const sec = await sectionOf(item);
  if (!sec) return;
  let cols = [];
  try {
    cols = (await server.collections(sec, 0, 300)).items.filter(c => !c.smart);
  } catch (e) {
    error('collections failed', e);
  }
  const add = c => server.addToCollection(c.ratingKey, item.ratingKey).then(changed, e => error('add to collection failed', e));
  showMenu({
    title: 'Add to collection',
    subtitle: item.title + '  ·  everyone on this server sees collections',
    items: cols.map(c => ({ icon: icons.collection, label: c.title, run: () => add(c) })).concat(cols.length ? [null] : [], [{
      icon: icons.collection, label: 'New collection…', run: async () => {
        const title = await showPrompt({ title: 'Name the collection', placeholder: 'Collection name' });
        if (title && title.trim()) server.createCollection(sec, item.type === 'show' ? 2 : 1, title.trim(), item.ratingKey).then(changed, e => error('new collection failed', e));
      },
    }]),
  });
}

// Item menu → Add to playlist: the user's playlists, or a new one.
export async function addToPlaylistMenu(item) {
  const server = session.server;
  let lists = [];
  try {
    lists = (await server.playlists()).filter(pl => !pl.smart);
  } catch (e) {
    error('playlists failed', e);
  }
  const add = pl => server.addToPlaylist(pl.ratingKey, item.ratingKey).then(() => server.invalidate(), e => error('add to playlist failed', e));
  showMenu({
    title: 'Add to playlist',
    subtitle: item.title,
    items: lists.map(pl => ({ icon: icons.list, label: pl.title, run: () => add(pl) })).concat(lists.length ? [null] : [], [{
      icon: icons.list, label: 'New playlist…', run: async () => {
        const title = await showPrompt({ title: 'Name the playlist', placeholder: 'Playlist name' });
        if (title && title.trim()) server.createPlaylist(title.trim(), item.ratingKey).then(() => server.invalidate(), e => error('new playlist failed', e));
      },
    }]),
  });
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
  showFixMatch(item, await matchQuery(item), changed);
}

// extra: items for the top of the menu (the detail page's audio and subtitles).
export function itemMenu(item, { continueWatching = false, onPage = false, onChange, playlist = null, collection = null, extra = [] } = {}) {
  if (item && (item.type === 'collection' || item.type === 'playlist')) { shelfMenu(item, { onChange }); return; }
  if (!item || item.remote || item.type === 'person' || item.type === 'review') return;
  const server = session.server;
  const changed = () => { server.invalidate(); if (onChange) onChange(); };
  const act = fn => () => fn().then(changed, e => error('item action failed', e));
  const playable = item.type === 'movie' || item.type === 'episode';
  const nav = extra.slice();
  const state = [];

  if (playable && item.viewOffset) nav.push({ icon: icons.play, label: 'Resume' + (item.duration ? ' · ' + duration(item.duration - item.viewOffset) + ' left' : ' from ' + clock(item.viewOffset)), run: () => playItem(item, { offset: item.viewOffset }) });
  if (playable) nav.push({ icon: icons.restart, label: 'Play from start', run: () => playItem(item, { offset: 0 }) });
  if (playlist && playable) nav.push({ icon: icons.play, label: 'Play playlist from here', run: () => playPlaylist(playlist, { from: item }) });
  if (playable) nav.push({ icon: icons.film, label: 'File info', run: () => showFileInfo(item) });
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
  const markUnwatched = { icon: icons.uncheck, label: 'Mark as unwatched', run: act(() => server.unscrobble(item.ratingKey)) };
  state.push(watched ? markUnwatched : { icon: icons.check, label: 'Mark as watched', run: act(() => server.scrobble(item.ratingKey)) });
  // Part-way through: unwatched clears the progress, so offer both, as Plex does.
  if (!watched && playable && item.viewOffset) state.push(markUnwatched);
  if (item.type === 'episode' && item.parentRatingKey) {
    state.push({ icon: icons.check, label: 'Mark season as watched', run: act(() => server.scrobble(item.parentRatingKey)) });
  }
  if (continueWatching) {
    state.push({ icon: icons.close, label: 'Remove from Continue Watching', run: act(() => {
      removedFromContinueWatching.add(item.ratingKey);
      return server.removeFromContinueWatching(item.ratingKey);
    }) });
  }
  if (playable || item.type === 'show' || item.type === 'season') {
    state.push({ icon: icons.list, label: 'Add to playlist…', run: () => addToPlaylistMenu(item) });
  }
  if (isAdmin() && collectionTarget(item)) {
    const t = collectionTarget(item);
    state.push({ icon: icons.collection, label: t === item ? 'Add to collection…' : 'Add show to collection…', run: () => addToCollectionMenu(t, changed) });
    if (collection && !collection.smart) {
      state.push({ icon: icons.close, label: 'Remove from collection', run: act(() => server.removeFromCollection(collection.ratingKey, item.ratingKey)) });
    }
  }
  if (playlist && item.playlistItemID) {
    state.push({ icon: icons.close, label: 'Remove from playlist', run: act(() => session.server.removeFromPlaylist(playlist.ratingKey, item.playlistItemID)) });
  }
  if (item.type !== 'season') {
    state.push({ icon: icons.star, label: item.userRating ? 'Your rating: ' + stars(item.userRating / 2) : 'Rate…', run: () => rateMenu(item, act) });
  }
  if ((item.type === 'movie' || item.type === 'show') && isAdmin()) { // changes the library for everyone
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
