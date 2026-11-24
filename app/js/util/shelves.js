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

// [{ ratingKey, kind: 'collection' | 'playlist', title, thumb, sectionKey, sectionType, onHome }]
export function shelves() {
  return store.get(key('shelves'), []);
}

function save(list) {
  version++;
  store.set(key('shelves'), list.length ? list : undefined);
}

export function shelfFor(ratingKey) {
  return shelves().find(s => s.ratingKey === String(ratingKey)) || null;
}

export function pinShelf(item) {
  if (shelfFor(item.ratingKey)) return;
  const playlist = item.type === 'playlist';
  save(shelves().concat([{
    ratingKey: String(item.ratingKey),
    kind: playlist ? 'playlist' : 'collection',
    title: item.title,
    thumb: item.thumb || item.composite || '',
    sectionKey: playlist ? undefined : item.librarySectionID,
    sectionType: playlist ? undefined : (item.subtype === 'show' ? 'show' : 'movie'),
    onHome: false,
  }]));
}

export function unpinShelf(ratingKey) {
  save(shelves().filter(s => s.ratingKey !== String(ratingKey)));
}

export function renameShelf(ratingKey, title) {
  if (!shelfFor(ratingKey)) return;
  save(shelves().map(s => (s.ratingKey === String(ratingKey) ? Object.assign({}, s, { title }) : s)));
}

export function setShelfOnHome(ratingKey, on) {
  save(shelves().map(s => (s.ratingKey === String(ratingKey) ? Object.assign({}, s, { onHome: !!on }) : s)));
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
