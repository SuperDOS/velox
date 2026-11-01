import * as store from './store.js';

export function duration(ms) {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return min + 'm';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

// long: always h:mm:ss, so times in a video over an hour keep one width.
export function clock(ms, long) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = n => (n < 10 ? '0' : '') + n;
  return (hh || long ? hh + ':' + pad(mm) : mm) + ':' + pad(ss);
}

// The top-bar clock: '24', '12' or 'off'. Defaults by TV language. Times like
// "Ends at" use 12 or 24 even when the clock is off.
export function clockMode() {
  return store.get('clock', /^en-US/i.test(navigator.language || '') ? '12' : '24');
}

function use24h() {
  return clockMode() !== '12';
}

export function timeOfDay(date) {
  const mm = date.getMinutes();
  const pad = (mm < 10 ? ':0' : ':') + mm;
  if (use24h()) return (date.getHours() < 10 ? '0' : '') + date.getHours() + pad;
  const hh = date.getHours();
  return (hh % 12 || 12) + pad + (hh >= 12 ? ' PM' : ' AM');
}

export function episodeLabel(item) {
  if (item.type !== 'episode') return '';
  return 'S' + (item.parentIndex || 0) + ' · E' + (item.index || 0);
}

// The line under a title: "2019 · PG-13 · 2h 4m" style. Pass score: false
// where ratings() is drawn next to it.
export function metaLine(item, { score = true } = {}) {
  const parts = [];
  if (item.type === 'episode') {
    parts.push(episodeLabel(item));
    if (item.originallyAvailableAt) parts.push(item.originallyAvailableAt.slice(0, 4));
  } else if (item.year) {
    parts.push(item.year);
  }
  if (item.contentRating) parts.push(item.contentRating);
  if (item.type === 'show' && item.childCount) parts.push(item.childCount + (item.childCount === 1 ? ' season' : ' seasons'));
  else if (item.duration) parts.push(duration(item.duration));
  if (score && item.audienceRating) parts.push('★ ' + Number(item.audienceRating).toFixed(1));
  return parts.join('  ·  ');
}

const percent = v => Math.round(v * 10) + '%';
const RATING_KINDS = {
  'rottentomatoes://image.rating.ripe': { icon: 'rtFresh', text: percent },
  'rottentomatoes://image.rating.rotten': { icon: 'rtRotten', text: percent },
  'rottentomatoes://image.rating.upright': { icon: 'rtUpright', text: percent },
  'rottentomatoes://image.rating.spilled': { icon: 'rtSpilled', text: percent },
  'imdb://image.rating': { icon: 'imdb', text: v => v.toFixed(1) },
  'themoviedb://image.rating': { icon: 'tmdb', text: percent },
};

// Scores with their source: Rotten Tomatoes critic, Rotten Tomatoes audience,
// IMDb, TMDB. Full metadata has a Rating list; list responses only the flat
// rating/audienceRating fields.
export function ratings(item) {
  const list = (item.Rating || []).slice();
  if (!list.length) {
    if (item.rating && item.ratingImage) list.push({ image: item.ratingImage, value: item.rating, type: 'critic' });
    if (item.audienceRating && item.audienceRatingImage) list.push({ image: item.audienceRatingImage, value: item.audienceRating, type: 'audience' });
  }
  const out = [];
  for (const r of list) {
    const kind = RATING_KINDS[r.image];
    if (kind && r.value) out.push({ icon: kind.icon, text: kind.text(Number(r.value)), critic: r.type === 'critic' });
  }
  const rank = r => (r.critic ? 0 : r.icon === 'imdb' ? 2 : r.icon === 'tmdb' ? 3 : 1);
  out.sort((a, b) => rank(a) - rank(b));
  if (out.length) return out;
  return item.audienceRating ? [{ icon: 'star', text: Number(item.audienceRating).toFixed(1) }] : [];
}

// What the file is, as badges: 4K, Dolby Vision / HDR10 / HLG, Atmos, the
// audio format and channels, and whether it has subtitles.
export function mediaFlags(item) {
  const media = (item.Media || [])[0];
  const part = media && (media.Part || [])[0];
  if (!media) return [];
  const streams = (part && part.Stream) || [];
  const video = streams.find(s => s.streamType === 1) || {};
  const audio = streams.find(s => s.streamType === 2 && s.selected) || streams.find(s => s.streamType === 2) || {};
  const flags = [];
  const res = { '4k': '4K', 1080: '1080p', 720: '720p', 480: 'SD', 576: 'SD', sd: 'SD' }[String(media.videoResolution).toLowerCase()];
  if (res) flags.push(res);
  if (video.DOVIPresent) flags.push('Dolby Vision');
  else if (/smpte2084/i.test(video.colorTrc || '')) flags.push('HDR10');
  else if (/arib-std-b67/i.test(video.colorTrc || '')) flags.push('HLG');
  const title = (audio.displayTitle || '') + ' ' + (audio.extendedDisplayTitle || '');
  const codec = String(audio.codec || media.audioCodec || '').toLowerCase();
  if (/atmos/i.test(title)) flags.push('Atmos');
  const fmt = /dts:?x/i.test(title) ? 'DTS:X' : codec === 'truehd' ? 'TrueHD' : codec === 'dca' || codec === 'dts' ? (/ma|hd/i.test(audio.profile || '') ? 'DTS-HD MA' : 'DTS')
    : codec === 'eac3' ? 'DD+' : codec === 'ac3' ? 'Dolby Digital' : codec === 'aac' ? 'AAC' : codec === 'flac' ? 'FLAC' : codec ? codec.toUpperCase() : '';
  if (fmt) flags.push(fmt);
  const ch = audio.channels || media.audioChannels;
  const chName = ch >= 8 ? '7.1' : ch >= 6 ? '5.1' : ch === 2 ? 'Stereo' : ch === 1 ? 'Mono' : '';
  if (chName) flags.push(chName);
  if (streams.some(s => s.streamType === 3)) flags.push('Subtitles');
  return flags;
}

export function progress(item) {
  if (!item.viewOffset || !item.duration) return 0;
  return Math.min(1, item.viewOffset / item.duration);
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
