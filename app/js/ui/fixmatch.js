// Fix match: the candidates Plex finds for a movie or show, as a row of posters
// with the focused one's year and summary underneath, so the right one can be
// told apart. ▲ reaches the buttons at the top right, Search again (a title,
// optionally ending in a year) and Close; OK on a poster uses that match;
// Back closes too.
import { h, setText, toggleClass } from '../util/dom.js';
import * as router from '../router.js';
import { session } from '../session.js';
import { error } from '../util/log.js';
import { Row } from './row.js';
import { showPrompt } from './menu.js';
import * as icons from './icons.js';

// item: the movie or show. query: { title, year } to search for first.
// changed: runs after a match is applied.
const POSTER = { w: 280, h: 420 }; // bigger than a Home poster: there's room, and they're what tells matches apart

export function showFixMatch(item, query, changed) {
  const server = session.server;
  const el = h('div', 'fm', document.body);
  const head = h('div', 'fm-head', el);
  h('div', 'fm-title', head).textContent = 'Fix match';
  const sub = h('div', 'fm-sub', head);
  const buttons = h('div', 'fm-buttons', el);
  const again = h('div', 'btn fm-again', buttons);
  again.innerHTML = icons.search;
  h('span', '', again).textContent = 'Search again';
  const closeBtn = h('div', 'btn fm-close', buttons);
  closeBtn.innerHTML = icons.close;
  h('span', '', closeBtn).textContent = 'Close';
  const rowBox = h('div', 'fm-row', el);
  const status = h('div', 'fm-status', el);
  const info = h('div', 'fm-info', el);
  const name = h('div', 'fm-name', info);
  const meta = h('div', 'fm-meta', info);
  const summary = h('div', 'fm-summary', info);
  const hint = h('div', 'fm-hint', info);

  let row = null;
  let results = [];
  let zone = 'row';
  let button = 0; // in the top zone: 0 Search again, 1 Close
  let busy = false;

  function show(i) {
    const r = results[i];
    if (!r) return;
    setText(name, r.name || '');
    const current = r.guid === item.guid;
    setText(meta, [r.year, r.type === 'show' ? 'TV show' : 'Movie'].filter(Boolean).join('   ·   '));
    toggleClass(hint, 'current', current);
    setText(summary, r.summary || 'No summary.');
    setText(hint, current ? 'This is the current match' : 'OK to use this match');
  }

  function focusZone(z) {
    zone = results.length ? z : 'top';
    toggleClass(again, 'focus', zone === 'top' && button === 0);
    toggleClass(closeBtn, 'focus', zone === 'top' && button === 1);
    if (row) row.setActive(zone === 'row');
  }

  async function search(q) {
    setText(sub, item.title + '   ·   searching for “' + q.title + (q.year ? ' ' + q.year : '') + '”');
    setText(status, 'Searching…');
    status.style.display = '';
    info.style.display = 'none';
    try {
      results = (await server.matches(item.ratingKey, q.title, q.year)).slice(0, 30);
      // The match it has now first, if Plex found it again.
      const cur = results.findIndex(r => r.guid === item.guid);
      if (cur > 0) results.unshift(results.splice(cur, 1)[0]);
    } catch (e) {
      error('match search failed', e);
      results = [];
    }
    if (!el.parentNode) return;
    rowBox.innerHTML = '';
    row = null;
    if (!results.length) {
      setText(status, 'No matches found. Press ▲ to search for a different title.');
      focusZone('top');
      return;
    }
    status.style.display = 'none';
    info.style.display = '';
    const items = results.map(r => ({
      type: r.type === 'show' ? 'show' : 'movie', title: r.name, sub: r.guid === item.guid ? 'Current' : (r.year ? String(r.year) : ''),
      thumb: r.thumb, ratingKey: r.guid,
    }));
    row = new Row({ kind: 'poster', size: POSTER, caption: true, items, onFocus: (it, rw) => show(rw.index) });
    rowBox.appendChild(row.el);
    show(0);
    focusZone('row');
  }

  async function searchAgain() {
    const text = await showPrompt({ title: 'Search for a title', value: query.title + (query.year ? ' ' + query.year : ''), placeholder: 'Title, and a year if you like' });
    router.setModal(keys); // the prompt was the modal while it was open
    if (text === null || !text.trim()) return;
    // A year at the end narrows it: "Victoria 2016".
    const m = text.trim().match(/^(.*?)\s*\(?((?:19|20)\d\d)\)?$/);
    query = m && m[1] ? { title: m[1], year: m[2] } : { title: text.trim(), year: undefined };
    search(query);
  }

  async function use(r) {
    if (busy || r.guid === item.guid) return;
    busy = true;
    setText(hint, 'Matching…');
    try {
      await server.match(item.ratingKey, r);
      close();
      changed();
    } catch (e) {
      error('fix match failed', e);
      setText(hint, 'That didn\'t work. Try another, or Back to leave it.');
      busy = false;
    }
  }

  function close() {
    router.setModal(null);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  const keys = {
    onKey(action) {
      // Everything else (the long-press menu included) stays inside Fix match.
      if (action === 'back') { close(); return; }
      if (zone === 'top') {
        if (action === 'left' || action === 'right') { button = action === 'left' ? 0 : 1; focusZone('top'); }
        else if (action === 'enter') { if (button === 0) searchAgain(); else close(); }
        else if (action === 'down' && results.length) focusZone('row');
        return;
      }
      if (!row) return;
      if (action === 'up') { button = 0; focusZone('top'); }
      else if (action === 'left' || action === 'right') row.move(action === 'left' ? -1 : 1);
      else if (action === 'enter') use(results[row.index]);
    },
  };
  router.setModal(keys);
  search(query);
}
