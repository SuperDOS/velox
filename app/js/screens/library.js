// A whole library, one collection, or a library's collections as a virtualized
// poster grid, loaded page by page. ▲ from the top row reaches the toolbar
// (shuffle, unwatched filter, sort, collections); yellow cycles the sort;
// CH▲/CH▼ jump by letter (title sort) or by page.
import { h, setText, toggleClass, fitText } from '../util/dom.js';
import { Grid } from '../ui/grid.js';
import { useAmbience } from '../ui/backdrop.js';
import { session } from '../session.js';
import { prefetch } from '../ui/images.js';
import { isFast } from '../input.js';
import * as icons from '../ui/icons.js';
import { openItem, playItem, openCollection, openCollections, openRecommended, openGenres, shuffle, itemMenu } from '../nav.js';
import { showMenu } from '../ui/menu.js';
import { error } from '../util/log.js';
import { metaLine } from '../util/format.js';
import * as store from '../util/store.js';
import { pref } from '../util/prefs.js';
import { onLibraryChange } from '../plex/events.js';

const PAGE = 140;
// Server filters offered under Filter, in this order (unwatched has its own button;
// people/locations/labels have too many values to pick from a list).
const FILTER_KEYS = ['genre', 'decade', 'year', 'contentRating', 'resolution', 'hdr', 'dovi', 'hdr10plus', 'atmos',
  'inProgress', 'audioLanguage', 'subtitleLanguage', 'country', 'studio', 'videoCodec', 'audioCodec', 'editionTitle'];
const SORTS = [
  { id: 'titleSort', label: 'A–Z' },
  { id: 'addedAt:desc', label: 'Recently added' },
  { id: 'originallyAvailableAt:desc', label: 'Release date' },
  { id: 'audienceRating:desc', label: 'Rating' },
];

// filter: start filtered ({ key, value, label }), e.g. a genre from Genres.
export function LibraryScreen(section, { collection = null, collections = false, filter: startFilter = null } = {}) {
  const el = h('div', 'screen library');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  const titleEl = h('h1', 'lib-title', head);
  if (collection || collections) {
    titleEl.textContent = collection ? collection.title : section.title + ' · Collections';
  } else {
    // A whole library: its kind's icon (film strip / TV), as in Plex. The
    // toolbar leaves no room for a long library name.
    titleEl.classList.add('lib-icon');
    head.classList.add('lib-head-icon');
    titleEl.innerHTML = section.type === 'show' ? icons.tv : icons.film;
  }
  const count = h('div', 'lib-count', head);
  const toolsEl = h('div', 'lib-tools', head);
  const focusInfo = h('div', 'lib-focus', el);
  const hint = h('div', 'lib-hint', el);

  const whole = !collection && !collections;
  const movies = section.type !== 'show';
  const noun = collections ? 'collections' : movies ? 'movies' : 'shows';
  let sortIndex = 0;
  let unwatched = whole && !!store.get('unwatched:' + section.key, false);
  let filter = startFilter;  // { key, value, label }
  let pages = new Map();     // page -> 'loading' | true
  let items = [];
  let letters = [];          // [{ title: 'A', start: 0 }]
  let generation = 0;
  let zone = 'grid';
  let tools = [];
  let toolIndex = 0;

  const type = movies ? 1 : 2;

  hint.innerHTML = whole ? '<i class="key-yellow"></i> Sort &nbsp;&nbsp; CH ▲▼ Jump' : 'CH ▲▼ Jump';

  let ready = false;
  const grid = new Grid({
    top: 200, height: 880, total: 0,
    getItem: i => items[i],
    onFocus: (item, index) => {
      // Warm posters for the row just past the recycled pool.
      if (!isFast()) {
        const start = (Math.floor(index / grid.cols) + grid.poolRows - 1) * grid.cols;
        for (let i = start; i < start + grid.cols; i++) {
          if (items[i]) prefetch(session.server.image(items[i].thumb, 216, 324));
        }
      }
      if (!item) { setText(focusInfo, ''); return; }
      setText(focusInfo, item.title + '   ' + (item.type === 'collection' ? (item.childCount || 0) + ' ' + (item.subtype === 'show' ? 'shows' : 'movies') : metaLine(item)));
      ambience.set(item.UltraBlurColors);
    },
    onSelect: item => (item.type === 'collection' ? openCollection(item, section) : openItem(item)),
    onNeed: (start, end) => {
      // The grid asks once while it's being built; reload() below loads page 0.
      if (!ready) return;
      for (let p = Math.floor(start / PAGE); p <= Math.floor(end / PAGE); p++) loadPage(p);
    },
  });
  ready = true;
  el.appendChild(grid.el);

  function fetchPage(start, size) {
    const server = session.server;
    if (collection) return server.collectionItems(collection.ratingKey, start, size);
    if (collections) return server.collections(section.key, start, size);
    return server.items(section.key, start, size, { sort: SORTS[sortIndex].id, type, unwatched, filter });
  }

  async function loadPage(p) {
    if (pages.has(p)) return;
    if (grid.total && p * PAGE >= grid.total) return;
    pages.set(p, 'loading');
    const gen = generation;
    try {
      const res = await fetchPage(p * PAGE, PAGE);
      if (gen !== generation) return;
      res.items.forEach((it, i) => { items[p * PAGE + i] = it; });
      pages.set(p, true);
      if (grid.total !== res.total) {
        grid.setTotal(res.total);
        setText(count, res.total + ' ' + (unwatched ? 'unwatched ' : '') + noun + (filter ? '  ·  ' + filter.label : ''));
      } else {
        grid.refresh();
      }
      if (p === 0 && res.items[0]) grid.onFocus(grid.current());
      if (p === 0 && !res.total) setText(count, '0 ' + noun);
    } catch (e) {
      pages.delete(p);
      error('library page failed', section.title, p, e);
    }
  }

  async function loadLetters() {
    letters = [];
    if (!whole || SORTS[sortIndex].id !== 'titleSort') return;
    const gen = generation;
    try {
      const mc = await session.server.get('/library/sections/' + section.key + '/firstCharacter', { type, unwatched: unwatched ? 1 : undefined, [filter ? filter.key : '_']: filter ? filter.value : undefined });
      if (gen !== generation) return;
      let start = 0;
      letters = (mc.Directory || []).map(d => {
        const l = { title: d.title, start };
        start += d.size;
        return l;
      });
    } catch (e) { /* letter jump just won't work */ }
  }

  function reload() {
    generation++;
    pages = new Map();
    items = [];
    grid.total = 0;
    grid.index = 0;
    grid.refresh();
    renderTools();
    loadPage(0);
    loadLetters();
  }

  // Quiet refresh: refetch the pages already loaded and swap them in, keeping
  // the selection on the same title even if new media shifted it. Used when
  // coming back to the grid and on a timer (Settings → Home → Auto-refresh).
  let visible = true;
  let refreshing = false;
  let refreshedAt = Date.now();
  async function softRefresh() {
    if (refreshing || !visible || document.hidden) return;
    refreshing = true;
    refreshedAt = Date.now();
    const gen = generation;
    try {
      const loaded = [...pages].filter(([, v]) => v === true).map(([p]) => p).sort((a, b) => a - b);
      if (!loaded.length) return;
      const results = await Promise.all(loaded.map(p => fetchPage(p * PAGE, PAGE).then(res => ({ p, res }))));
      if (gen !== generation) return; // sorted or filtered meanwhile
      const total = results[0].res.total;
      const focusedKey = grid.current() && grid.current().ratingKey;
      const next = [];
      results.forEach(({ p, res }) => res.items.forEach((it, i) => { next[p * PAGE + i] = it; }));
      const changed = total !== grid.total || next.some((it, i) => !items[i] || items[i].ratingKey !== it.ratingKey || items[i].viewCount !== it.viewCount || items[i].viewOffset !== it.viewOffset);
      if (!changed) return;
      generation++; // loads still in flight were for the old list
      items = next;
      pages = new Map(loaded.map(p => [p, true]));
      if (total !== grid.total) {
        grid.setTotal(total);
        setText(count, total + ' ' + (unwatched ? 'unwatched ' : '') + noun + (filter ? '  ·  ' + filter.label : ''));
        loadLetters();
      } else {
        grid.refresh();
      }
      const at = focusedKey ? next.findIndex(it => it && it.ratingKey === focusedKey) : -1;
      if (at >= 0 && at !== grid.index) grid.focusIndex(at);
      else grid.onFocus(grid.current(), grid.index);
    } catch (e) {
      error('library refresh failed', section.title, e);
    } finally {
      refreshing = false;
    }
  }
  const refreshTimer = setInterval(() => {
    const mins = pref('homeRefresh');
    if (mins && Date.now() - refreshedAt >= mins * 60000) softRefresh();
  }, 15000);
  const onWake = () => { if (!document.hidden && Date.now() - refreshedAt > 20000) softRefresh(); };
  document.addEventListener('visibilitychange', onWake);
  // The server says a scan finished (for this library, or unknown): refresh.
  const unwatch = onLibraryChange(ids => {
    if (ids.size && !ids.has(String(section.key))) return;
    if (visible) softRefresh(); else refreshedAt = 0;
  });

  // --- Toolbar ------------------------------------------------------------

  function renderTools() {
    toolsEl.innerHTML = '';
    tools = [];
    const add = (icon, label, run) => {
      const b = h('div', 'btn btn-sm', toolsEl);
      b.innerHTML = icon;
      h('span', '', b).textContent = label;
      tools.push({ el: b, run });
    };
    if (movies && !collections) add(icons.shuffle, 'Shuffle', doShuffle);
    if (whole) {
      add(unwatched ? icons.check : icons.uncheck, 'Unwatched', () => {
        unwatched = !unwatched;
        store.set('unwatched:' + section.key, unwatched);
        reload();
      });
      add(icons.sort, SORTS[sortIndex].label, cycleSort);
      add(icons.filter, filter ? filter.label : 'Filter', openFilters);
      add(icons.genres, 'Genres', () => openGenres(section));
      add(icons.collection, 'Collections', () => openCollections(section));
      add(icons.star, 'Recommended', () => openRecommended(section));
    }
    toolIndex = Math.min(toolIndex, tools.length - 1);
    renderZone();
  }

  function renderZone() {
    toggleClass(el, 'in-tools', zone === 'tools');
    tools.forEach((t, i) => toggleClass(t.el, 'focus', zone === 'tools' && i === toolIndex));
  }

  // Filter: pick a kind (genre, decade, HDR…), then a value for it.
  async function openFilters() {
    let kinds = [];
    try {
      const mc = await session.server.get('/library/sections/' + section.key + '/filters', { type }, { maxAge: 600000 });
      const byKey = {};
      (mc.Directory || []).forEach(d => { byKey[d.filter] = d; });
      kinds = FILTER_KEYS.map(k => byKey[k]).filter(Boolean);
    } catch (e) {
      error('filters failed', e);
    }
    const apply = f => { filter = f; reload(); };
    const items = kinds.map(d => ({
      label: d.title, on: !!filter && filter.key === d.filter,
      run: () => (d.filterType === 'boolean' ? apply({ key: d.filter, value: 1, label: d.title }) : pickValue(d, apply)),
    }));
    if (filter) items.unshift({ icon: icons.close, label: 'Clear filter (' + filter.label + ')', run: () => apply(null) }, null);
    showMenu({ title: 'Filter ' + section.title, items });
  }

  async function pickValue(kind, apply) {
    try {
      const mc = await session.server.get('/library/sections/' + section.key + '/' + kind.filter, { type }, { maxAge: 600000 });
      const values = (mc.Directory || []).map(d => ({
        label: d.title, on: !!filter && filter.key === kind.filter && String(filter.value) === String(d.key),
        run: () => apply({ key: kind.filter, value: d.key, label: kind.title === 'Genre' ? d.title : kind.title + ': ' + d.title }),
      }));
      showMenu({ title: kind.title, items: values.length ? values : [{ label: 'Nothing to filter by', run: () => {} }] });
    } catch (e) {
      error('filter values failed', e);
    }
  }

  function cycleSort() {
    sortIndex = (sortIndex + 1) % SORTS.length;
    reload();
  }

  function doShuffle() {
    if (collection) shuffle({ collection, total: grid.total });
    else shuffle({ sections: [section], unwatched });
  }

  reload();

  function jump(dir) {
    if (letters.length) {
      const i = grid.index;
      let li = letters.findIndex((l, k) => i >= l.start && (k === letters.length - 1 || i < letters[k + 1].start));
      li = Math.max(0, Math.min(letters.length - 1, li + dir));
      grid.focusIndex(letters[li].start);
      setText(focusInfo, letters[li].title);
    } else {
      grid.focusIndex(grid.index + dir * grid.cols * 3);
    }
  }

  return {
    el,
    name: 'library',
    destroy() { clearInterval(refreshTimer); document.removeEventListener('visibilitychange', onWake); unwatch(); },
    onHide() { visible = false; },
    onShow() {
      visible = true;
      ambience.restore();
      if (!whole) fitText(titleEl, 58, 36);
      // Back from a title page or the player: watched state and new media.
      if (Date.now() - refreshedAt > 5000) softRefresh();
    },
    onKey(action) {
      if (zone === 'tools') {
        switch (action) {
          case 'left': toolIndex = Math.max(0, toolIndex - 1); renderZone(); return true;
          case 'right': toolIndex = Math.min(tools.length - 1, toolIndex + 1); renderZone(); return true;
          case 'down': case 'back': zone = 'grid'; renderZone(); return true;
          case 'enter': if (tools[toolIndex]) tools[toolIndex].run(); return true;
        }
        return true;
      }
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'up':
          if (grid.index < grid.cols && tools.length) { zone = 'tools'; renderZone(); return true; }
          grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'pageup': jump(-1); return true;
        case 'pagedown': jump(1); return true;
        case 'enter': grid.select(); return true;
        case 'play': case 'playpause': if (grid.current() && grid.current().type !== 'collection') playItem(grid.current()); return true;
        case 'yellow': if (whole) cycleSort(); return true;
        case 'menu': {
          // Refetch just the focused page afterwards: watched badges change.
          const page = Math.floor(grid.index / PAGE);
          itemMenu(grid.current(), { onChange: () => { pages.delete(page); loadPage(page); } });
          return true;
        }
        case 'back':
          if (grid.index > grid.cols * 2) { grid.focusIndex(0); return true; }
          return false;
      }
      return false;
    },
  };
}
