// Search across the server. Focusing the input brings up Samsung's on-screen
// keyboard; results update as you type.
import { h, setText, setTransform } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { session } from '../session.js';
import { openItem, playItem, itemMenu, openPerson } from '../nav.js';
import { error } from '../util/log.js';
import * as icons from '../ui/icons.js';
import { useAmbience } from '../ui/backdrop.js';
import * as store from '../util/store.js';

const IME_DONE = 65376;
const IME_CANCEL = 65385;
const RECENT_MAX = 12;

// What was opened from search results, newest first, per Plex Home user:
// shown when the box is empty, so the remote's keyboard isn't needed twice.
const recentKey = () => 'recentSearch:' + ((session.user && session.user.uuid) || '');
const KEEP = ['ratingKey', 'key', 'type', 'title', 'thumb', 'art', 'year', 'grandparentTitle', 'grandparentThumb',
  'grandparentRatingKey', 'parentRatingKey', 'parentTitle', 'parentIndex', 'index', 'sub', 'tagKey', 'filter', 'viewCount', 'leafCount', 'viewedLeafCount'];
function remember(item) {
  const slim = {};
  KEEP.forEach(k => { if (item[k] != null) slim[k] = item[k]; });
  const list = store.get(recentKey(), []).filter(x => x.ratingKey !== item.ratingKey);
  list.unshift(slim);
  store.set(recentKey(), list.slice(0, RECENT_MAX));
}

export function SearchScreen() {
  const el = h('div', 'screen search');
  const ambience = useAmbience();
  const bar = h('div', 'search-bar', el);
  const icon = h('div', 'search-icon', bar);
  icon.innerHTML = icons.search;
  const input = h('input', 'search-input', bar);
  input.type = 'text';
  input.placeholder = 'Search movies, shows and people';
  input.setAttribute('autocomplete', 'off');
  const status = h('div', 'search-status', el);
  const clip = h('div', 'search-rows', el);
  const track = h('div', 'rows-track', clip);

  let rows = [];
  let rowIndex = -1; // -1 = input
  let timer = 0;
  let query = '';
  let generation = 0;

  async function run(q) {
    query = q;
    const gen = ++generation;
    if (q.length < 2) { setRows(recentHubs()); setText(status, ''); return; }
    setText(status, 'Searching…');
    try {
      const hubs = await session.server.search(q);
      if (gen !== generation) return;
      setRows(hubs);
      setText(status, hubs.length ? '' : 'Nothing found for “' + q + '”');
    } catch (e) {
      error('search failed', e);
      setText(status, 'Search failed');
    }
  }

  // Actors and directors in one People row after the titles, each person once
  // (in the shape the cast row uses, so the actor page opens as from a title).
  function withPeople(hubs) {
    const titles = hubs.filter(hb => hb.type !== 'actor' && hb.type !== 'director');
    const seen = new Set();
    const people = [];
    hubs.filter(hb => hb.type === 'actor' || hb.type === 'director').forEach(hb => {
      (hb.Metadata || hb.Directory || []).forEach(p => {
        if (seen.has(p.tag)) return;
        seen.add(p.tag);
        const role = hb.type === 'director' ? 'Director' : 'Actor';
        people.push({ type: 'person', title: p.tag, sub: role, thumb: p.thumb, tagKey: p.tagKey, filter: p.filter,
          ratingKey: 'person:' + p.id + ':' + role.toLowerCase() });
      });
    });
    return people.length ? titles.concat([{ title: 'People', type: 'person', Metadata: people }]) : titles;
  }

  function recentHubs() {
    const list = store.get(recentKey(), []);
    const titles = list.filter(x => x.type !== 'person');
    const people = list.filter(x => x.type === 'person');
    return [].concat(titles.length ? [{ title: 'Recently searched', type: 'recent', Metadata: titles }] : [],
      people.length ? [{ title: 'Recently searched people', type: 'person', Metadata: people, recent: true }] : []);
  }

  function setRows(hubs) {
    track.innerHTML = '';
    let y = 0;
    rows = (hubs.some(hb => hb.recent || hb.type === 'recent') ? hubs : withPeople(hubs)).map(hub => {
      if (hub.type === 'person') {
        const row = new Row({ title: hub.title, kind: 'person', caption: true, items: hub.Metadata, onSelect: p => { remember(p); openPerson(p); } });
        setTransform(row.el, 'translateY(' + y + 'px)');
        row.y = y;
        y += row.height;
        track.appendChild(row.el);
        return row;
      }
      const row = new Row({
        title: hub.title, kind: hub.type === 'episode' ? 'episode' : 'poster',
        caption: true, items: hub.Metadata, onSelect: item => { remember(item); openItem(item); },
      });
      setTransform(row.el, 'translateY(' + y + 'px)');
      row.y = y;
      y += row.height;
      track.appendChild(row.el);
      return row;
    });
    if (rowIndex >= rows.length) rowIndex = rows.length - 1;
    render();
  }

  function render() {
    rows.forEach((r, i) => r.setActive(i === rowIndex));
    el.classList.toggle('in-input', rowIndex < 0);
    const y = rowIndex > 0 ? rows[rowIndex].y : 0;
    setTransform(track, 'translateY(' + (-y) + 'px)');
  }

  function focusInput() {
    rowIndex = -1;
    render();
    input.focus();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 350);
  });
  input.addEventListener('keydown', e => {
    if (e.keyCode === IME_DONE || e.keyCode === 13) {
      input.blur();
      run(input.value.trim());
      if (rows.length) { rowIndex = 0; render(); }
    } else if (e.keyCode === IME_CANCEL) {
      input.blur();
    }
  });

  return {
    el,
    name: 'search',
    onShow() {
      ambience.restore();
      if (!query) setRows(recentHubs());
      if (rowIndex < 0) setTimeout(focusInput, 50);
    },
    onHide() { input.blur(); },
    onKey(action) {
      if (rowIndex < 0) {
        if (action === 'down' && rows.length) { input.blur(); rowIndex = 0; render(); return true; }
        if (action === 'enter') { input.focus(); return true; }
        if (action === 'back') { input.blur(); return false; }
        return true;
      }
      const row = rows[rowIndex];
      switch (action) {
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'up': if (rowIndex === 0) focusInput(); else { rowIndex--; render(); } return true;
        case 'down': if (rowIndex < rows.length - 1) { rowIndex++; render(); } return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': if (row.current() && row.current().type !== 'person') playItem(row.current()); return true;
        case 'menu': itemMenu(row.current()); return true;
        case 'back': focusInput(); return true;
      }
      return false;
    },
    destroy() { clearTimeout(timer); generation++; },
  };
}
