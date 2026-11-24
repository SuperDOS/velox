// Shelves: collections and playlists pinned by a Plex Home user, shown next to
// the libraries in Home's top bar (and, if chosen, as Home rows). A kid's
// profile can get a "Disney" collection one press away; anyone a playlist of
// favourite episodes. Also each user's Home row order and hidden rows.
// Saved on this TV, per user.
import * as store from './store.js';
import { session } from '../session.js';

let version = 0;
// Bumped on every change, so Home knows to rebuild when it's shown again.
export const shelvesVersion = () => version;

const who = () => (session.user && session.user.uuid) || '';
const key = name => name + ':' + who();

// [{ ratingKey, kind: 'collection' | 'playlist', title, thumb, sectionKey, sectionType, inBar, onHome }]
// inBar: pinned in Home's top bar (older entries without it were); onHome:
// shown as a Home row. An entry with neither is dropped.
export function shelves() {
  return store.get(key('shelves'), []);
}

// The ones pinned in the top bar.
export const barShelves = () => shelves().filter(s => s.inBar !== false);

function entryFor(item) {
  const playlist = item.type === 'playlist' || item.kind === 'playlist';
  return {
    ratingKey: String(item.ratingKey),
    kind: playlist ? 'playlist' : 'collection',
    title: item.title,
    thumb: item.thumb || item.composite || '',
    sectionKey: playlist ? undefined : item.librarySectionID || item.sectionKey,
    sectionType: playlist ? undefined : item.sectionType || (item.subtype === 'show' ? 'show' : 'movie'),
    inBar: false,
    onHome: false,
  };
}

function update(item, change) {
  const rk = String(item.ratingKey);
  const list = shelves();
  const at = list.findIndex(s => s.ratingKey === rk);
  const next = Object.assign(at >= 0 ? Object.assign({ inBar: true }, list[at]) : entryFor(item), change);
  if (!next.inBar && !next.onHome) list.splice(at, at >= 0 ? 1 : 0);
  else if (at >= 0) list[at] = next;
  else list.push(next);
  save(list);
}

function save(list) {
  version++;
  store.set(key('shelves'), list.length ? list : undefined);
}

export function shelfFor(ratingKey) {
  return shelves().find(s => s.ratingKey === String(ratingKey)) || null;
}

export function inBar(ratingKey) {
  const s = shelfFor(ratingKey);
  return !!s && s.inBar !== false;
}

export function onHome(ratingKey) {
  const s = shelfFor(ratingKey);
  return !!s && !!s.onHome;
}

export function pinShelf(item) {
  update(item, { inBar: true });
}

// Out of the top bar (a Home row stays).
export function unpinShelf(ratingKey) {
  update({ ratingKey }, { inBar: false });
}

// One place earlier (dir -1) or later (+1) among the ones in the top bar, which
// is also their order in the Pinned list. Settings → Home → Top bar.
export function moveShelf(ratingKey, dir) {
  const list = shelves();
  const bar = list.map((s, i) => (s.inBar !== false ? i : -1)).filter(i => i >= 0);
  const at = bar.findIndex(i => list[i].ratingKey === String(ratingKey));
  const to = at + dir;
  if (at < 0 || to < 0 || to >= bar.length) return false;
  const t = list[bar[at]]; list[bar[at]] = list[bar[to]]; list[bar[to]] = t;
  save(list);
  return true;
}

// Gone altogether (a deleted collection).
export function forgetShelf(ratingKey) {
  save(shelves().filter(s => s.ratingKey !== String(ratingKey)));
}

export function renameShelf(ratingKey, title) {
  if (!shelfFor(ratingKey)) return;
  save(shelves().map(s => (s.ratingKey === String(ratingKey) ? Object.assign({}, s, { title }) : s)));
}

// item: the playlist or collection (for one not pinned yet), or its ratingKey.
export function setShelfOnHome(item, on) {
  update(typeof item === 'object' ? item : { ratingKey: item }, { onHome: !!on });
}

// Home rows: { order: [hubIdentifier…], hidden: [hubIdentifier…] }.
export function homeRows() {
  return Object.assign({ order: [], hidden: [] }, store.get(key('homeRows'), {}));
}

export function setHomeRows(rows) {
  version++;
  store.set(key('homeRows'), rows.order.length || rows.hidden.length ? rows : undefined);
}

// Shelf rows go after Continue Watching until the user orders them.
export function withShelfRows(hubs, shelfHubs) {
  const cw = hubs.findIndex(hb => /continue|ondeck/i.test(hb.hubIdentifier));
  return hubs.slice(0, cw + 1).concat(shelfHubs, hubs.slice(cw + 1));
}

// Hubs in the user's order with the hidden ones left out. Hubs not ordered
// yet (new ones from the server) keep their place relative to the server's
// list, after the ordered ones that came before them there.
// keepHidden: all of them, in order (the Settings editor).
export function arrangeHubs(hubs, { keepHidden = false } = {}) {
  const { order, hidden } = homeRows();
  const shown = keepHidden ? hubs : hubs.filter(hb => hidden.indexOf(hb.hubIdentifier) === -1);
  if (!order.length) return shown;
  const rank = new Map();
  let last = -1;
  shown.forEach((hb, i) => {
    const at = order.indexOf(hb.hubIdentifier);
    if (at >= 0) last = at;
    rank.set(hb, at >= 0 ? at : last + (i + 1) / 1000);
  });
  return shown.slice().sort((a, b) => rank.get(a) - rank.get(b));
}
