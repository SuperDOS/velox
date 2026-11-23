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
