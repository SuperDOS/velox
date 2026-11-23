// Home: hero for the focused item, nav bar, and Plex's home hubs as rows.
// The last hub payload is cached so a cold start paints instantly.
import { h, setText, setTransform, toggleClass, fitText } from '../util/dom.js';
import { Row } from '../ui/row.js';
import { pickCarousel } from '../ui/carousel.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { session } from '../session.js';
import { metaLine, timeOfDay, clockMode } from '../util/format.js';
import { spoiler } from '../ui/tile.js';
import { renderRatings } from '../ui/ratings.js';
import { isFast } from '../input.js';
import * as store from '../util/store.js';
import { pref, shuffleShows, prefsVersion } from '../util/prefs.js';
import * as icons from '../ui/icons.js';
import { openItem, playItem, selectEpisode, openLibrary, openSearch, openSettings, openWatchlist, openExplore, openHub, homeShuffle, itemMenu, removedFromContinueWatching } from '../nav.js';
import { error, log } from '../util/log.js';
import { onLibraryChange } from '../plex/events.js';
import { publishPreview } from '../platform/preview.js';

const ROWS_TOP = 600;
const NAV_PAD = 80; // wider than the 64px edge fade in app.css

function slimHub(hub) {
  // Keep the cache small: only fields the home screen renders.
  const keep = ['ratingKey', 'key', 'type', 'title', 'grandparentTitle', 'parentTitle', 'year', 'thumb', 'art',
    'grandparentThumb', 'grandparentArt', 'parentThumb', 'index', 'parentIndex', 'duration', 'viewOffset',
    'viewCount', 'leafCount', 'viewedLeafCount', 'childCount', 'contentRating', 'audienceRating', 'summary',
    'rating', 'ratingImage', 'audienceRatingImage',
    'originallyAvailableAt', 'UltraBlurColors', 'grandparentRatingKey', 'parentRatingKey', 'Image'];
  return {
    hubIdentifier: hub.hubIdentifier, title: hub.title, type: hub.type, key: hub.key, more: hub.more,
    Metadata: hub.Metadata.map(m => {
      const o = {};
      for (const k of keep) if (m[k] !== undefined) o[k] = m[k];
      return o;
    }),
  };
}

export function heroArtPath(item) {
  if (item.type === 'episode' || item.type === 'season') return item.grandparentArt || item.art;
  return item.art;
}

export function clearLogo(item) {
  const img = (item.Image || []).find(i => i.type === 'clearLogo');
  return img ? img.url : '';
}

export function HomeScreen() {
  const el = h('div', 'screen home');
  const ambience = useAmbience();
  const hero = new HeroArt(el, 'hero-art home-art');

  const top = h('header', 'topbar', el);
  const brand = h('div', 'brand', top);
  const brandText = h('div', 'brand-text', brand);
  h('img', 'brand-wordmark', brandText).src = 'img/velox-logo.png';
  // The nav is a clip with a sliding track, so any number of libraries fits.
  const navEl = h('nav', 'nav', top);
  const navTrack = h('div', 'nav-track', navEl);
  const clockEl = h('div', 'topbar-clock', top);
  const tick = () => setText(clockEl, clockMode() === 'off' ? '' : timeOfDay(new Date()));
  tick();
  const clockTimer = setInterval(tick, 5000);

  const info = h('div', 'hero-info', el);
  const heroEyebrow = h('div', 'hero-eyebrow', info); // the carousel's theme, while it has focus
  const heroLogo = h('img', 'hero-logo', info);
  const heroTitle = h('h1', 'hero-title', info);
  const heroMetaRow = h('div', 'hero-meta', info);
  const heroMeta = h('span', '', heroMetaRow);
  const heroRatings = h('span', 'ratings', heroMetaRow);
  const heroSummaryWrap = h('div', 'summary-wrap', info);
  const heroSummary = h('p', 'hero-summary', heroSummaryWrap);
  // Featured carousel (Settings → Home): a Play button and page dots under the
  // summary, shown only while focus is on the hero.
  const heroPlay = h('div', 'hero-play', info);
  heroPlay.innerHTML = icons.play;
  const heroPlayLabel = h('span', '', heroPlay);
  const heroDots = h('div', 'hero-dots', info);

  const rowsClip = h('div', 'home-rows', el);
  rowsClip.style.top = ROWS_TOP + 'px';
  const track = h('div', 'rows-track', rowsClip);
  const empty = h('div', 'home-empty', el);

  let rows = [];
  let offsets = [];
  let rowIndex = 0;
  let zone = pref('heroCarousel') ? 'hero' : 'rows';
  let featured = [];
  let featuredLabel = '';    // e.g. Theme of the day's "Thriller night"
  let featuredPending = false; // a server pick on its way: the hero waits for it
  let homeSections = [];
  let dead = false;
  let slide = 0;
  let slideTimer = 0;
  let builtWith = prefsVersion();
  let carouselWas = pref('heroCarousel');
  let navItems = [];
  let navIndex = 0;
  let navScroll = 0;
  let loadedAt = 0;
  let visible = true; // this screen is on top (not behind another screen or playback)
  let heroTimer = 0;
  let artTimer = 0;
  let reportedPaint = false;

  function buildNav(sections) {
    homeSections = sections; // the carousel's random picks come from these
    navTrack.innerHTML = '';
    navItems = [{ label: 'Home', id: 'home' }]
      .concat(sections.map(s => ({ label: s.title, id: 'section', section: s })))
      .concat(pref('showExplore') ? [{ label: 'Explore', id: 'explore', icon: icons.compass }] : [])
      .concat([{ label: 'Watchlist', id: 'watchlist', icon: icons.bookmark }])
      .concat(sections.some(s => s.type === 'movie') || shuffleShows().length ? [{ label: 'Shuffle', id: 'shuffle', icon: icons.shuffle }] : [])
      .concat([{ label: 'Search', id: 'search', icon: icons.search }, { label: 'Settings', id: 'settings', icon: icons.gear }]);
    navIndex = Math.min(navIndex, navItems.length - 1);
    navItems.forEach((n, i) => {
      if (n.icon && !navItems[i - 1].icon) h('i', 'nav-sep', navTrack);
      n.el = h('div', 'nav-item' + (n.icon ? ' nav-icon' : ''), navTrack);
      if (n.icon) n.el.innerHTML = n.icon;
      else h('span', '', n.el).textContent = n.label;
    });
    renderNav();
  }

  // Slide the track just enough to keep the focused item clear of the edge fades.
  function scrollNav() {
    const room = navEl.clientWidth;
    if (!room) return; // hidden screen: nothing to measure
    const max = Math.max(0, navTrack.offsetWidth - room);
    const n = navItems[navIndex];
    if (zone === 'nav' && n) {
      const left = n.el.offsetLeft;
      const right = left + n.el.offsetWidth;
      if (left - NAV_PAD < navScroll) navScroll = left - NAV_PAD;
      else if (right + NAV_PAD > navScroll + room) navScroll = right + NAV_PAD - room;
    }
    navScroll = Math.round(Math.max(0, Math.min(max, navScroll)));
    setTransform(navTrack, 'translateX(' + (-navScroll) + 'px)');
    toggleClass(navEl, 'more-left', navScroll > 0);
    toggleClass(navEl, 'more-right', navScroll < max - 1);
  }

  function renderNav() {
    scrollNav(); // measure before the class writes below dirty the style
    navItems.forEach((n, i) => {
      toggleClass(n.el, 'focus', zone === 'nav' && i === navIndex);
      toggleClass(n.el, 'current', n.id === 'home');
    });
    toggleClass(el, 'in-nav', zone === 'nav');
  }

  function showHero(item) {
    if (!item) return;
    const logoPath = clearLogo(item);
    const server = session.server;
    if (logoPath && item.type !== 'episode') {
      heroLogo.src = server.image(logoPath, 640, 200, { format: 'png' });
      heroLogo.style.display = '';
      heroTitle.style.display = 'none';
    } else {
      heroLogo.style.display = 'none';
      heroTitle.style.display = '';
      setText(heroTitle, item.type === 'episode' ? item.grandparentTitle : item.title);
      fitText(heroTitle, 64, 40);
    }
    setText(heroMeta, (item.type === 'episode' ? item.title + '  ·  ' : '') + metaLine(item, { score: false }));
    renderRatings(heroRatings, item);
    setText(heroSummary, item.summary || '');
    toggleClass(heroSummaryWrap, 'spoiler', spoiler(item) && !!item.summary); // blurred; the episode page can reveal it
    ambience.set(item.UltraBlurColors);
    clearTimeout(artTimer);
    artTimer = setTimeout(() => hero.set(server.image(heroArtPath(item), 1344, 756)), isFast() ? 350 : 120);
  }

  function onFocusItem(item) {
    if (zone === 'hero') return; // the carousel owns the hero
    clearTimeout(heroTimer);
    // While a key is held, skip the text repaint until the user settles.
    if (isFast()) heroTimer = setTimeout(() => showHero(item), 160);
    else showHero(item);
  }

  function setFeatured(r) {
    // Keep the slide on the same item across refreshes when it's still featured.
    const was = featured[slide] && featured[slide].ratingKey;
    featured = r.items;
    featuredLabel = r.label || '';
    slide = Math.max(0, featured.findIndex(m => m.ratingKey === was));
  }

  function showSlide() {
    const item = featured[slide];
    setText(heroEyebrow, item ? featuredLabel : '');
    if (!item) return;
    showHero(item);
    setText(heroPlayLabel, item.viewOffset ? 'Resume' : item.type === 'show' || item.type === 'season' ? 'Play next' : 'Play');
    heroDots.innerHTML = '';
    featured.forEach((_, i) => h('i', i === slide ? 'on' : '', heroDots));
  }

  function moveSlide(dir) {
    if (!featured.length) return;
    slide = (slide + dir + featured.length) % featured.length;
    showSlide();
    armSlides(); // a manual move restarts the wait
  }

  // Rotates only while the hero has focus and Home is what's on screen.
  function armSlides() {
    clearInterval(slideTimer);
    slideTimer = 0;
    if (zone !== 'hero' || !visible || featured.length < 2) return;
    slideTimer = setInterval(() => { if (!document.hidden && !isFast()) moveSlide(1); }, 8000);
  }

  function setZone(z) {
    zone = z;
    toggleClass(el, 'in-hero', zone === 'hero');
    renderNav();
    renderRows();
    if (zone === 'hero') showSlide();
    else if (zone === 'rows' && rows[rowIndex]) showHero(rows[rowIndex].shown());
    armSlides();
  }

  const heroOn = () => pref('heroCarousel') && (featured.length > 0 || featuredPending);

  function layoutRows() {
    offsets = [];
    let y = 0;
    rows.forEach(r => {
      offsets.push(y);
      setTransform(r.el, 'translateY(' + y + 'px)');
      y += r.height;
    });
  }

  function renderRows() {
    rows.forEach((r, i) => {
      r.setActive(zone === 'rows' && i === rowIndex);
      toggleClass(r.el, 'above', i < rowIndex);
    });
    setTransform(track, 'translateY(' + (-(offsets[rowIndex] || 0)) + 'px)');
  }

  let hideWatched = pref('homeHideWatched');
  const watched = m => (m.type === 'show' || m.type === 'season' ? m.leafCount && m.viewedLeafCount >= m.leafCount : m.viewCount && !m.viewOffset);

  function setHubs(all) {
    // Drop what was just removed from Continue Watching; forget it once the
    // server stops listing it.
    const removed = removedFromContinueWatching;
    const listed = new Set();
    const hubs = all.map(hb => {
      if (!/continue|ondeck/i.test(hb.hubIdentifier) || !removed.size) return hb;
      (hb.Metadata || []).forEach(m => listed.add(m.ratingKey));
      return Object.assign({}, hb, { Metadata: (hb.Metadata || []).filter(m => !removed.has(m.ratingKey)) });
    }).map(hb => {
      // Settings → Hide watched on Home (Continue Watching stays as it is).
      if (!hideWatched || /continue|ondeck/i.test(hb.hubIdentifier)) return hb;
      return Object.assign({}, hb, { Metadata: (hb.Metadata || []).filter(m => !watched(m)) });
    }).filter(hb => hb.Metadata && hb.Metadata.length);
    removed.forEach(k => { if (!listed.has(k)) removed.delete(k); });
    // Settings → Library → Episode artwork: Thumbnails turns rows of episodes
    // into wide rows of their own pictures, with captions.
    const thumbs = pref('episodeArt') === 'thumb';
    const kindFor = hb => (thumbs && hb.Metadata.filter(m => m.type === 'episode').length * 2 >= hb.Metadata.length ? 'wide' : 'poster');
    const sameShape = hubs.length === rows.length && builtWith === prefsVersion()
      && hubs.every((hb, i) => rows[i].hubId === hb.hubIdentifier && rows[i].kind === kindFor(hb) && !!rows[i].more === !!(hb.more && hb.key));
    const focusedKey = rows[rowIndex] && rows[rowIndex].current() && rows[rowIndex].current().ratingKey;
    if (sameShape) {
      hubs.forEach((hb, i) => rows[i].setItems(hb.Metadata, i === rowIndex ? focusedKey : null));
    } else {
      track.innerHTML = '';
      rows = hubs.map(hb => {
        const resumable = /continue|ondeck/i.test(hb.hubIdentifier);
        // Settings → Continue Watching: OK can resume instead of opening the page.
        // Settings → Home → Episode: OK can play instead of opening the page.
        const select = item => {
          if (resumable && pref('continueWatching') === 'play') playItem(item, { offset: item.viewOffset || 0 });
          else if (!resumable && item.type === 'episode') selectEpisode(item);
          else openItem(item);
        };
        const kind = kindFor(hb);
        const menu = item => itemMenu(item, { continueWatching: resumable, onChange: load });
        // Plex says there's more than the row holds: a View all tile at the end.
        const more = hb.more && hb.key
          ? { onSelect: () => openHub({ title: hb.title, key: hb.key }, { select, menu, play: item => playItem(item) }) }
          : null;
        const row = new Row({
          // Posters by default, Continue Watching included (an episode shows its
          // show's poster, with the progress bar).
          title: hb.title, kind, caption: kind === 'wide', items: hb.Metadata,
          onFocus: onFocusItem, onSelect: select, more,
        });
        row.hubId = hb.hubIdentifier;
        track.appendChild(row.el);
        return row;
      });
      builtWith = prefsVersion();
      rowIndex = Math.min(rowIndex, Math.max(0, rows.length - 1));
      layoutRows();
    }
    // Settings → Home → Carousel shows. A pick from the server arrives later.
    const pick = pickCarousel(pref('carouselSource'), { hubs, sections: homeSections, server: session.server }, r => {
      if (dead) return;
      featuredPending = false;
      setFeatured(r);
      if (zone === 'hero') { if (heroOn()) showSlide(); else setZone(rows.length ? 'rows' : 'nav'); }
      armSlides();
    });
    featuredPending = !pick;
    if (pick) setFeatured(pick);
    if (zone === 'hero' && !heroOn()) zone = 'rows';
    setText(empty, rows.length ? '' : 'Nothing here yet. Add some media to your Plex server.');
    setZone(zone);
    if (!reportedPaint && rows.length) {
      reportedPaint = true;
      log('home rows ready at ' + Math.round(performance.now()) + 'ms after page start');
    }
    return hubs;
  }

  async function load() {
    const server = session.server;
    loadedAt = Date.now();
    try {
      const [sections, hubs] = await Promise.all([server.sections(), server.hubs()]);
      buildNav(sections);
      const shown = setHubs(hubs);
      publishPreview(server, shown);
      store.set('homeCache', { server: server.id, sections, hubs: shown.map(slimHub) });
    } catch (e) {
      error('home load failed', e);
      if (!rows.length) setText(empty, 'Couldn\'t load from ' + server.name + '. Press OK to retry.');
    }
  }

  const cached = store.get('homeCache');
  if (cached && session.server && cached.server === session.server.id) {
    buildNav(cached.sections || []);
    setHubs(cached.hubs || []);
  } else {
    buildNav([]);
  }
  // New media shows up without leaving the screen: refresh now and then while
  // Home is on top (Settings → Home → Auto-refresh), and when the TV wakes.
  const refreshTimer = setInterval(() => {
    const mins = pref('homeRefresh');
    if (!mins || !visible || document.hidden) return;
    if (Date.now() - loadedAt >= mins * 60000) load();
  }, 15000);
  const onWake = () => { if (!document.hidden && visible && Date.now() - loadedAt > 20000) load(); };
  document.addEventListener('visibilitychange', onWake);
  // The server says a scan finished: refresh now (or when we're next shown).
  const unwatch = onLibraryChange(() => { if (visible) load(); else loadedAt = 0; });
  // Inter swaps in after first paint and changes the label widths.
  if (document.fonts) document.fonts.ready.then(renderNav);
  load();

  function activateNav(n) {
    if (n.id === 'section') openLibrary(n.section);
    else if (n.id === 'shuffle') homeShuffle(navItems.filter(x => x.section && x.section.type === 'movie').map(x => x.section));
    else if (n.id === 'watchlist') openWatchlist();
    else if (n.id === 'explore') openExplore();
    else if (n.id === 'search') openSearch();
    else if (n.id === 'settings') openSettings();
  }

  return {
    el,
    name: 'home',
    destroy() { dead = true; clearInterval(clockTimer); clearInterval(refreshTimer); clearInterval(slideTimer); document.removeEventListener('visibilitychange', onWake); unwatch(); },
    onHide() { visible = false; armSlides(); },
    onShow() {
      visible = true;
      ambience.restore();
      if (hideWatched !== pref('homeHideWatched')) { hideWatched = pref('homeHideWatched'); load(); }
      toggleClass(top, 'no-brand', !pref('homeLogo'));
      renderNav(); // widths can't be measured while the screen was hidden
      if (builtWith !== prefsVersion()) {
        // Settings changed tile looks or the carousel: rebuild from the last data.
        const c = store.get('homeCache');
        if (c && c.hubs) setHubs(c.hubs);
      }
      // The carousel just turned on in Settings: show it now, not after the
      // next move (from the rows it takes over; from the top bar the hero
      // shows its slide, and ▼ goes into it).
      const turnedOn = pref('heroCarousel') && !carouselWas;
      carouselWas = pref('heroCarousel');
      if (zone === 'hero' && !heroOn()) setZone('rows');
      else if (turnedOn && heroOn()) { if (zone === 'rows') setZone('hero'); else showSlide(); }
      else armSlides();
      // Coming back from playback: progress and Continue Watching changed.
      if (Date.now() - loadedAt > 5000) load();
    },
    onKey(action) {
      if (zone === 'nav') {
        if (action === 'left') { navIndex = Math.max(0, navIndex - 1); renderNav(); return true; }
        if (action === 'right') { navIndex = Math.min(navItems.length - 1, navIndex + 1); renderNav(); return true; }
        if (action === 'down' && heroOn()) { setZone('hero'); return true; }
        if (action === 'down' && rows.length) { setZone('rows'); return true; }
        if (action === 'enter') { activateNav(navItems[navIndex]); return true; }
        if (action === 'back') return false;
        return true;
      }
      if (zone === 'hero') {
        const item = featured[slide];
        switch (action) {
          case 'left': moveSlide(-1); return true;
          case 'right': moveSlide(1); return true;
          case 'up': setZone('nav'); return true;
          case 'down': if (rows.length) setZone('rows'); return true;
          case 'enter': case 'play': case 'playpause': if (item) playItem(item, { offset: item.viewOffset || 0 }); return true;
          case 'info': if (item) openItem(item); return true;
          case 'menu': if (item) itemMenu(item, { onChange: load }); return true;
        }
        return false;
      }
      const row = rows[rowIndex];
      if (!row) {
        if (action === 'up') { zone = 'nav'; renderNav(); return true; }
        if (action === 'enter') { load(); return true; }
        return false;
      }
      switch (action) {
        case 'left': row.move(-1); return true;
        case 'right': row.move(1); return true;
        case 'up':
          if (rowIndex === 0) { setZone(heroOn() ? 'hero' : 'nav'); return true; }
          rowIndex--; renderRows(); onFocusItem(rows[rowIndex].shown()); return true;
        case 'down':
          if (rowIndex < rows.length - 1) { rowIndex++; renderRows(); onFocusItem(rows[rowIndex].shown()); }
          return true;
        case 'enter': row.select(); return true;
        case 'play': case 'playpause': if (row.current()) playItem(row.current()); return true;
        case 'menu': if (row.current()) itemMenu(row.current(), { continueWatching: /continue|ondeck/i.test(row.hubId), onChange: load }); return true;
        case 'back':
          // Back from deep in the rows returns to the top first.
          if (rowIndex > 0 || row.index > 0) {
            rowIndex = 0; rows.forEach(r => r.focusIndex(0)); renderRows(); onFocusItem(rows[0].shown());
            return true;
          }
          if (heroOn()) { setZone('hero'); return true; }
          return false;
      }
      return false;
    },
  };
}
