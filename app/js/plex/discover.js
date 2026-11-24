// Plex's Discover service (plex.tv account token): people's bios and credits
// beyond what's in the library.
import { request } from './client.js';
import { session } from '../session.js';

const DISCOVER = 'https://discover.provider.plex.tv';
let warmed = false;

// The TV takes seconds to open its first TLS connection; open it while the
// user is still looking at the cast row, not after they pick someone.
export function warm() {
  if (warmed) return;
  warmed = true;
  fetch(DISCOVER + '/identity').catch(() => {});
}

export async function person(id) {
  const json = await request(DISCOVER + '/library/people/' + id, { token: session.token });
  return ((json.MediaContainer || {}).Metadata || [])[0] || null;
}

// [{ type: 'actor' | 'director' | 'appeared' | ..., title, Credit: [{ role, Metadata }] }]
export async function credits(id) {
  const json = await request(DISCOVER + '/library/people/' + id + '/credits', { token: session.token });
  return (json.MediaContainer || {}).CreditGroup || [];
}

// --- Watchlist (plex.tv, per account) -----------------------------------
// Discover ids are the 24-hex tail of a plex:// guid.

export function discoverId(item) {
  const guid = item.type === 'episode' || item.type === 'season' ? (item.grandparentGuid || item.parentGuid) : item.guid;
  const m = /^plex:\/\/(movie|show|episode|season)\/([0-9a-f]{24})$/.exec(guid || '');
  return m ? m[2] : null;
}

export async function watchlist(start, size) {
  const json = await request(DISCOVER + '/library/sections/watchlist/all', {
    token: session.token,
    params: { sort: 'watchlistedAt:desc', includeCollections: 1, includeExternalMedia: 1, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size },
  });
  const mc = json.MediaContainer || {};
  return { total: mc.totalSize != null ? mc.totalSize : mc.size, items: mc.Metadata || [] };
}

export async function onWatchlist(id) {
  const json = await request(DISCOVER + '/library/metadata/' + id + '/userState', { token: session.token });
  const st = (json.MediaContainer || {}).UserState;
  const state = Array.isArray(st) ? st[0] : st;
  return !!(state && state.watchlistedAt);
}

export function setWatchlisted(id, on) {
  return request(DISCOVER + '/actions/' + (on ? 'addToWatchlist' : 'removeFromWatchlist'), {
    method: 'PUT', token: session.token, params: { ratingKey: id },
  });
}

// --- Explore: Plex's own suggestion rows (Trending on Your Services, Most
// Watchlisted This Week, Coming Soon…), as Plex promotes them, with their
// first movies and shows. Trailer and browse-by rows are left out.

export async function exploreHubs(count = 20) {
  const json = await request(DISCOVER + '/hubs/promoted', { token: session.token, params: { includeMeta: 1 } });
  const hubs = ((json.MediaContainer || {}).Hub || [])
    .filter(hb => hb.key && !/trailer|genres|decades|award|preferred-services/i.test(hb.key));
  return Promise.all(hubs.map(hb => request(DISCOVER + hb.key, { token: session.token, params: { count, includeMeta: 1 } })
    .then(j => ({ title: hb.title, items: ((j.MediaContainer || {}).Metadata || []).filter(m => m.type === 'movie' || m.type === 'show') }),
      () => ({ title: hb.title, items: [] }))));
}

// --- A title's Discover record (plex.tv) ----------------------------------
// Fetched once per title per run, for what the library doesn't have:
// oscars: { wins, nominations } or null (films only)
// advisory: Common Sense Media's { age, line } or null
// reviews: Rotten Tomatoes critics' [{ critic, source, text, fresh }]
const detailCache = new Map();

function readDetails(json, type) {
  const m = ((json.MediaContainer || {}).Metadata || [])[0] || {};
  const oscarList = (m.AwardNominee || []).filter(a => a.award === 'Oscar');
  const csm = (m.CommonSenseMedia || [])[0];
  const age = csm && (csm.AgeRating || []).find(a => a.age);
  return {
    oscars: type === 'movie' && oscarList.length ? { wins: oscarList.filter(a => a.isWinner).length, nominations: oscarList.length } : null,
    advisory: csm && (age || csm.oneLiner) ? { age: age ? age.age : null, line: csm.oneLiner || '' } : null,
    reviews: (m.Review || []).filter(r => r.text).map(r => ({
      critic: r.tag || '', source: r.source || '', text: r.text,
      fresh: /fresh|upright/.test(r.image || '') ? true : /rotten|spilled/.test(r.image || '') ? false : null,
    })),
  };
}

const detailId = item => (item.type === 'movie' || item.type === 'show' ? discoverId(item) : null);

// Known now: the record, null (none), or undefined (not asked yet / on its way).
export function cachedDetails(item) {
  const id = detailId(item);
  if (!id) return null;
  const v = detailCache.get(id);
  return v && typeof v.then === 'function' ? undefined : v;
}

export function loadDetails(item) {
  const id = detailId(item);
  if (!id) return Promise.resolve(null);
  if (!detailCache.has(id)) {
    detailCache.set(id, request(DISCOVER + '/library/metadata/' + id, { token: session.token, params: { includeReviews: 1 } }).then(json => {
      const d = readDetails(json, item.type);
      detailCache.set(id, d);
      return d;
    }, () => { detailCache.set(id, null); return null; }));
  }
  return Promise.resolve(detailCache.get(id));
}

// A film's Oscars, from the same record.
export function cachedOscars(item) {
  if (item.type !== 'movie') return null;
  const d = cachedDetails(item);
  return d === undefined ? undefined : d && d.oscars;
}

export function loadOscars(item) {
  if (item.type !== 'movie') return Promise.resolve(null);
  return loadDetails(item).then(d => d && d.oscars);
}
