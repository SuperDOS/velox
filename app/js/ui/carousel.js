// What Home's featured carousel shows (Settings → Home → Carousel shows).
// Mixed, Continue Watching and Recently added come from Home's own rows; the
// others ask the server, and keep their picks while the app runs (Home
// refreshes often, and a carousel that reshuffles under you isn't a carousel).
// Surprise me picks one of the others each time the app starts; Theme of the
// day picks a genre per day.
import { error } from '../util/log.js';

export const CAROUSEL_SOURCES = {
  mixed: 'Mixed', continue: 'Continue Watching', recent: 'Recently added',
  movies: 'Random movies', shows: 'Random shows', episodes: 'Random episodes', both: 'Random movies & shows',
  toprated: 'Top rated', theme: 'Theme of the day', surprise: 'Surprise me',
};
const SIZE = 6;
const SURPRISES = ['continue', 'recent', 'movies', 'shows', 'episodes', 'both', 'toprated', 'theme'];
let surprise = SURPRISES[Math.floor(Math.random() * SURPRISES.length)]; // once per app start
const picked = new Map(); // source + server → Promise<{ items, label }>

const isContinue = hb => /continue|ondeck/i.test(hb.hubIdentifier);
const keyOf = m => m.grandparentRatingKey || m.ratingKey;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function unique(list) {
  const seen = new Set();
  return list.filter(m => !seen.has(keyOf(m)) && seen.add(keyOf(m)));
}

// From Home's rows, at once.
function fromHubs(source, hubs) {
  const out = [];
  const seen = new Set();
  const add = m => {
    const k = keyOf(m);
    if (out.length < SIZE && !seen.has(k)) { seen.add(k); out.push(m); }
  };
  const cw = hubs.filter(isContinue);
  const rest = hubs.filter(hb => !isContinue(hb));
  if (source === 'continue') cw.forEach(hb => hb.Metadata.forEach(add));
  else {
    // Mixed: up to three from Continue Watching first. Both: then the newest
    // from the other rows, taken in turn.
    if (source === 'mixed') cw.forEach(hb => hb.Metadata.slice(0, 3).forEach(add));
    for (let i = 0; out.length < SIZE && i < SIZE; i++) rest.forEach(hb => { if (hb.Metadata[i]) add(hb.Metadata[i]); });
  }
  return out;
}

const TYPES = { movie: 1, show: 2, episode: 4 };

async function random(server, sections, kind, { sort = 'random', size = SIZE, query = null } = {}) {
  const want = kind === 'movie' ? 'movie' : 'show';
  const lists = await Promise.all(sections.filter(s => s.type === want).map(s =>
    server.items(s.key, 0, size, { sort, type: TYPES[kind], unwatched: true, query, summary: true })
      .then(r => r.items, () => [])));
  return [].concat.apply([], lists);
}

async function genreTheme(server, sections) {
  // Genres by name across movie and show libraries.
  const byName = new Map();
  await Promise.all(sections.map(async s => {
    try {
      const mc = await server.get('/library/sections/' + s.key + '/genre', { type: s.type === 'show' ? 2 : 1 }, { maxAge: 3600000 });
      (mc.Directory || []).forEach(d => {
        if (!byName.has(d.title)) byName.set(d.title, []);
        byName.get(d.title).push({ section: s, key: d.key });
      });
    } catch (e) { /* that library has no genres */ }
  }));
  const names = Array.from(byName.keys()).sort();
  if (!names.length) return { items: [], label: '' };
  const day = Math.floor(Date.now() / 86400000);
  // Today's genre, or the next ones if it has too few unwatched titles.
  for (let t = 0; t < Math.min(6, names.length); t++) {
    const name = names[(day * 7 + t) % names.length];
    const lists = await Promise.all(byName.get(name).map(g =>
      server.items(g.section.key, 0, SIZE, { sort: 'random', type: g.section.type === 'show' ? 2 : 1, unwatched: true, query: { genre: g.key }, summary: true })
        .then(r => r.items, () => [])));
    const items = shuffle([].concat.apply([], lists)).slice(0, SIZE);
    if (items.length >= 3) return { items, label: name + ' night' };
  }
  return { items: [], label: '' };
}

async function fetchSource(source, server, sections) {
  switch (source) {
    case 'movies': return { items: shuffle(await random(server, sections, 'movie')).slice(0, SIZE) };
    case 'shows': return { items: shuffle(await random(server, sections, 'show')).slice(0, SIZE) };
    case 'episodes': return { items: unique(shuffle(await random(server, sections, 'episode', { size: SIZE * 2 }))).slice(0, SIZE) };
    case 'both': {
      const [m, s] = await Promise.all([random(server, sections, 'movie'), random(server, sections, 'show')]);
      const a = shuffle(m);
      const b = shuffle(s);
      const out = [];
      for (let i = 0; out.length < SIZE && (i < a.length || i < b.length); i++) {
        if (a[i]) out.push(a[i]);
        if (b[i] && out.length < SIZE) out.push(b[i]);
      }
      return { items: out };
    }
    case 'toprated': {
      // The best rated unwatched (audience score), a different few each start.
      const [m, s] = await Promise.all([
        random(server, sections, 'movie', { sort: 'audienceRating:desc', size: 30 }),
        random(server, sections, 'show', { sort: 'audienceRating:desc', size: 30 }),
      ]);
      return { items: shuffle(m.concat(s).filter(x => x.audienceRating >= 7)).slice(0, SIZE) };
    }
    case 'theme': return genreTheme(server, sections);
  }
  return { items: [] };
}

// The source in use (Surprise me resolved for this run).
export function carouselSource(pref) {
  return pref === 'surprise' ? surprise : (CAROUSEL_SOURCES[pref] ? pref : 'mixed');
}

// { items, label } now when it can be had from the rows (or was fetched
// already); else null, and later() gets it when the server answers.
export function pickCarousel(pref, { hubs, sections, server }, later) {
  const source = carouselSource(pref);
  if (source === 'mixed' || source === 'continue' || source === 'recent') {
    const items = fromHubs(source, hubs);
    // Nothing to continue: the newest instead of an empty carousel.
    return { items: items.length ? items : fromHubs('recent', hubs), label: '' };
  }
  const key = source + '|' + server.id;
  let p = picked.get(key);
  if (!p) {
    p = fetchSource(source, server, sections || []).then(r => {
      const out = { items: r.items, label: r.label || '' };
      p.done = out;
      return out;
    }, e => {
      error('carousel ' + source + ' failed', e);
      picked.delete(key);
      return { items: [], label: '' };
    });
    picked.set(key, p);
  }
  if (p.done) return p.done.items.length ? p.done : { items: fromHubs('mixed', hubs), label: '' };
  p.then(r => later(r.items.length ? r : { items: fromHubs('mixed', hubs), label: '' }));
  return null;
}
