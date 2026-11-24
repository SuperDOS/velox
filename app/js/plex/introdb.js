// Intro, recap and credits times from IntroDB (api.introdb.app), a crowd-
// sourced list, for episodes Plex hasn't analysed. Opt-in (Settings →
// Playback → Fill in from IntroDB): it sends the show's IMDb id and the
// season and episode numbers to that site. Answers are kept on this TV.
import * as store from '../util/store.js';
import { session } from '../session.js';
import { warn } from '../util/log.js';

const SEGMENTS = 'https://api.introdb.app/segments';
// Confidence is 0–1, how well the submissions agree. Below this, skipping
// past real content on one bad entry is worse than no button.
const MIN_CONFIDENCE = 0.5;
const KEEP_MS = 7 * 86400000;      // a found entry
const KEEP_EMPTY_MS = 86400000;    // nothing yet: ask again tomorrow
const TYPES = { intro: 'intro', recap: 'recap', outro: 'credits' };

async function showImdb(ep) {
  const key = 'imdb:' + ep.grandparentRatingKey;
  const known = store.get(key);
  if (known !== undefined) return known;
  const show = await session.server.metadata(ep.grandparentRatingKey);
  const g = ((show && show.Guid) || []).find(x => /^imdb:\/\/tt\d+/.test(x.id));
  const id = g ? g.id.slice(7) : null;
  store.set(key, id);
  return id;
}

// Markers in Plex's shape ({ type, startTimeOffset, endTimeOffset }), or [].
export async function introDbMarkers(ep) {
  if (!ep || ep.type !== 'episode' || !ep.grandparentRatingKey || !(ep.parentIndex > 0) || !(ep.index > 0)) return [];
  const cacheKey = 'introdb:' + ep.ratingKey;
  const hit = store.get(cacheKey);
  if (hit && Date.now() - hit.at < (hit.list.length ? KEEP_MS : KEEP_EMPTY_MS)) return hit.list;
  try {
    const imdb = await showImdb(ep);
    if (!imdb) return [];
    const res = await fetch(SEGMENTS + '?imdb_id=' + imdb + '&season=' + ep.parentIndex + '&episode=' + ep.index);
    if (res.status === 404) { store.set(cacheKey, { at: Date.now(), list: [] }); return []; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const list = [];
    Object.keys(TYPES).forEach(k => {
      const seg = data[k];
      if (!seg || seg.end_ms == null || seg.start_ms == null || seg.end_ms <= seg.start_ms) return;
      if ((seg.confidence == null ? 1 : seg.confidence) < MIN_CONFIDENCE) return;
      list.push({ type: TYPES[k], startTimeOffset: seg.start_ms, endTimeOffset: seg.end_ms, fromIntroDb: true });
    });
    store.set(cacheKey, { at: Date.now(), list });
    return list;
  } catch (e) {
    warn('IntroDB lookup failed', e.message);
    return [];
  }
}
