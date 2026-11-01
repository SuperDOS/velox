// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { h, toggleClass, setTransform } from '../util/dom.js';
import { pref, setPref, shuffleShows, TEXT_SIZES, SKIP_STEPS, AUTOPLAY_STEPS, HOME_REFRESH_STEPS, SCREENSAVER_STEPS, STILL_WATCHING_STEPS } from '../util/prefs.js';
import { session, signOut, useServer } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { clockMode } from '../util/format.js';
import { QUALITIES, qualityLabel } from '../util/quality.js';
import * as store from '../util/store.js';
import { accentName, nextAccent, accents, setAccent, accentIndex } from '../ui/theme.js';
import { useAmbience } from '../ui/backdrop.js';
import { republishPreview } from '../platform/preview.js';
import { showMenu } from '../ui/menu.js';
import { showScreensaver } from '../ui/screensaver.js';

const CREDITS = { button: 'Skip Credits button', auto: 'Skip automatically', off: 'Ignore (no button)' };
const SAVER_STYLES = { logo: 'Velox logo', dvd: 'DVD logo', backdrops: 'Backdrops', pipes: '3D Pipes', starfield: 'Starfield', beziers: 'Bezier curves' };
const TEXT_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const CLOCKS = { 24: '24-hour', 12: '12-hour', off: 'Off' };

export function SettingsScreen() {
  const el = h('div', 'screen settings');
  const ambience = useAmbience();
  h('h1', 'settings-title', el).textContent = 'Settings';
  const clip = h('div', 'settings-clip', el);
  const list = h('div', 'settings-list', clip);
  const foot = h('div', 'settings-foot', el);
  foot.textContent = 'Velox ' + VERSION + (DEV ? ' (dev)' : '') + ' · ' + (session.server ? session.server.uri.replace(/X-Plex-Token=.*/, '') : '');

  // Categories down the left, the focused one's settings on the right.
  // ▲▼ on the left switches category; ▶ or OK moves into its settings, ◀ or
  // Back comes out again.
  const cats = h('div', 'settings-cats', el);
  let catIndex = 0;
  let zone = 'cats';
  let index = 0;
  let items = [];

  const CATEGORIES = [
    { name: 'Account', rows: () => [
      { label: 'Server', value: session.server ? session.server.name : '—', run: switchServer },
      { label: 'Signed in as', value: session.user ? session.user.title : '—', run: doSignOut, action: 'Sign out' },
    ] },
    { name: 'Appearance', rows: () => [
      // ◀▶ picks a swatch (live preview), OK cycles.
      { label: 'Accent colour', value: accentName(), swatches: accents(), run: () => { nextAccent(); build(); },
        adjust: dir => { setAccent(accentIndex() + dir); build(); } },
      { label: 'Poster corners', value: pref('tileCorners') === 'square' ? 'Square' : 'Rounded',
        run: () => { setPref('tileCorners', pref('tileCorners') === 'square' ? 'rounded' : 'square'); build(); } },
      { label: 'Watched badges', value: pref('badgeStyle') === 'box' ? 'Corner box' : 'Rounded',
        run: () => { setPref('badgeStyle', pref('badgeStyle') === 'box' ? 'pill' : 'box'); build(); } },
      { label: 'Text size', value: TEXT_LABELS[pref('textSize')] || 'Medium', run: () => moveTextSize(1), adjust: moveTextSize },
      toggleRow('Velox logo on Home', 'homeLogo'),
      { label: 'Clock', value: CLOCKS[clockMode()], run: () => { store.set('clock', { 24: '12', 12: 'off', off: '24' }[clockMode()]); build(); } },
      toggleRow('Startup animation', 'startupAnimation'),
      toggleRow('Theme music', 'themeMusic'),
    ] },
    { name: 'Home', rows: () => [
      refreshRow(),
      toggleRow('Hide watched on Home', 'homeHideWatched'),
      { label: 'Home Shuffle button', value: shuffleLabel(), run: () => pickShuffle() },
      { label: 'Continue Watching: OK', value: pref('continueWatching') === 'play' ? 'Plays' : 'Opens the page',
        run: () => { setPref('continueWatching', pref('continueWatching') === 'play' ? 'page' : 'play'); build(); } },
      { label: 'Home-bar tiles', value: pref('previewTiles') === 'poster' ? 'Posters' : 'Wide',
        run: () => { setPref('previewTiles', pref('previewTiles') === 'poster' ? 'wide' : 'poster'); republishPreview(); build(); } },
    ] },
    { name: 'Playback', rows: () => [
      { label: 'Streaming quality', value: qualityLabel(pref('quality')), run: () => moveQuality(1), adjust: moveQuality },
      stepRow('Skip back', 'skipBack'),
      stepRow('Skip forward', 'skipForward'),
      toggleRow('Auto-skip intros', 'autoSkipIntro'),
      { label: 'Credits', value: CREDITS[pref('credits')],
        run: () => { setPref('credits', { button: 'auto', auto: 'off', off: 'button' }[pref('credits')]); build(); } },
      autoplayRow(),
      stillWatchingRow(),
    ] },
    { name: 'Screensaver', rows: () => [
      screensaverRow(),
      { label: 'Style', value: SAVER_STYLES[pref('screensaverLogo')] || 'Velox logo', run: () => moveSaverStyle(1), adjust: moveSaverStyle },
      ...(pref('screensaverLogo') === 'backdrops' ? [toggleRow('Title and clock', 'screensaverText')] : []),
      { label: 'Preview', value: 'Any key to exit', run: () => showScreensaver() },
    ] },
  ].concat(DEV ? [{ name: 'Developer', rows: () => [
    { label: 'Performance overlay', value: hudEnabled() ? 'On' : 'Off', run: () => { setHud(!hudEnabled()); build(); } },
  ] }] : []);

  function build() {
    cats.innerHTML = '';
    CATEGORIES.forEach(c => { c.el = h('div', 'settings-cat', cats); c.el.textContent = c.name; });
    list.innerHTML = '';
    items = CATEGORIES[catIndex].rows();
    index = Math.min(index, items.length - 1);
    items.forEach(it => {
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      const value = h('span', 'setting-value', it.el);
      h('span', '', value).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
      if (it.swatches) {
        const row = h('span', 'swatches', value);
        it.swatches.forEach(sw => {
          const dot = h('i', 'swatch' + (sw.on ? ' on' : ''), row);
          dot.style.background = sw.hex;
        });
      }
    });
    render();
  }

  // Seconds the player's skip buttons jump; ◀▶ or OK steps through SKIP_STEPS.
  function stepRow(label, key) {
    const move = dir => {
      const i = Math.max(0, SKIP_STEPS.indexOf(pref(key)));
      setPref(key, SKIP_STEPS[(i + dir + SKIP_STEPS.length) % SKIP_STEPS.length]);
      build();
    };
    return { label, value: pref(key) + ' seconds', run: () => move(1), adjust: move };
  }

  // Overview text on Home and the show, season and episode pages.
  function moveTextSize(dir) {
    const keys = Object.keys(TEXT_SIZES);
    const i = Math.max(0, keys.indexOf(pref('textSize')));
    setPref('textSize', keys[Math.max(0, Math.min(keys.length - 1, i + dir))]);
    build();
  }

  function moveSaverStyle(dir) {
    const keys = Object.keys(SAVER_STYLES);
    const i = Math.max(0, keys.indexOf(pref('screensaverLogo')));
    setPref('screensaverLogo', keys[(i + dir + keys.length) % keys.length]);
    build();
  }

  function shuffleLabel() {
    const shows = shuffleShows();
    if (shows.length) return shows.length === 1 ? shows[0].title : shows.length + ' shows';
    return pref('homeShuffle') === 'all' ? 'All movies' : 'Unwatched movies';
  }

  // Unwatched or all movies, or a mix of shows: OK ticks a show on or off and
  // the menu stays open (shows with the most episodes first).
  let showList = null;
  async function pickShuffle() {
    const cur = pref('homeShuffle');
    const picked = shuffleShows();
    const set = v => { setPref('homeShuffle', v); build(); };
    const items = [
      { label: 'Unwatched movies', on: !picked.length && cur !== 'all', run: () => set('unwatched') },
      { label: 'All movies', on: !picked.length && cur === 'all', run: () => set('all') },
    ];
    try {
      if (!showList) {
        const server = session.server;
        const sections = (await server.sections()).filter(s => s.type === 'show');
        const lists = await Promise.all(sections.map(s => server.get('/library/sections/' + s.key + '/all', { type: 2 }).then(mc => mc.Metadata || [])));
        showList = [].concat.apply([], lists).sort((a, b) => (b.leafCount || 0) - (a.leafCount || 0));
      }
      if (showList.length) items.push(null);
      showList.forEach(s => {
        const it = {
          label: s.title + '  ·  ' + (s.leafCount || 0) + ' episodes', stay: true,
          on: picked.some(p => p.key === s.ratingKey),
          run: () => {
            const now = shuffleShows();
            const next = it.on ? now.filter(p => p.key !== s.ratingKey) : now.concat([{ key: s.ratingKey, title: s.title }]);
            set(next.length ? { shows: next } : 'unwatched');
            it.on = !it.on;
            // Shows replace the movie choices (and none left means unwatched movies).
            [items[0], items[1]].forEach((m, k) => {
              m.on = !next.length && k === 0;
              if (m.labelEl) m.labelEl.parentNode.classList.toggle('on', m.on);
            });
          },
        };
        items.push(it);
      });
    } catch (e) {
      error('shows for shuffle failed', e);
    }
    showMenu({ title: 'Home Shuffle button', subtitle: 'Tick shows to mix their episodes · Back when done', items });
  }

  function moveQuality(dir) {
    const i = Math.max(0, QUALITIES.findIndex(q => q.id === pref('quality')));
    setPref('quality', QUALITIES[(i + dir + QUALITIES.length) % QUALITIES.length].id);
    build();
  }

  // How often Home and the library grids look for new media while you're on them.
  function refreshRow() {
    const move = dir => {
      const i = Math.max(0, HOME_REFRESH_STEPS.indexOf(pref('homeRefresh')));
      setPref('homeRefresh', HOME_REFRESH_STEPS[(i + dir + HOME_REFRESH_STEPS.length) % HOME_REFRESH_STEPS.length]);
      build();
    };
    const m = pref('homeRefresh');
    return { label: 'Auto-refresh', value: m ? 'Every ' + (m === 1 ? 'minute' : m + ' minutes') : 'Only when opened', run: () => move(1), adjust: move };
  }

  function saverTime(m) {
    if (m < 1) return Math.round(m * 60) + ' seconds';
    return m === 1 ? '1 minute' : m + ' minutes';
  }

  function screensaverRow() {
    const move = dir => {
      const i = Math.max(0, SCREENSAVER_STEPS.indexOf(pref('screensaver')));
      setPref('screensaver', SCREENSAVER_STEPS[(i + dir + SCREENSAVER_STEPS.length) % SCREENSAVER_STEPS.length]);
      build();
    };
    const m = pref('screensaver');
    return { label: 'Screensaver', value: m ? 'After ' + saverTime(m) : 'Off', run: () => move(1), adjust: move };
  }

  // Up next: how long the countdown runs before the next episode plays, or off.
  // Passout protection: how long autoplay runs with no key press before asking.
  function stillWatchingRow() {
    const move = dir => {
      const i = Math.max(0, STILL_WATCHING_STEPS.indexOf(pref('stillWatching')));
      setPref('stillWatching', STILL_WATCHING_STEPS[(i + dir + STILL_WATCHING_STEPS.length) % STILL_WATCHING_STEPS.length]);
      build();
    };
    const hrs = pref('stillWatching');
    return { label: 'Still watching?', value: hrs ? 'Ask after ' + hrs + (hrs === 1 ? ' hour' : ' hours') : 'Never ask', run: () => move(1), adjust: move };
  }

  function autoplayRow() {
    const move = dir => {
      const i = Math.max(0, AUTOPLAY_STEPS.indexOf(pref('autoplay')));
      setPref('autoplay', AUTOPLAY_STEPS[(i + dir + AUTOPLAY_STEPS.length) % AUTOPLAY_STEPS.length]);
      build();
    };
    const s = pref('autoplay');
    return { label: 'Autoplay next episode', value: s ? 'After ' + s + ' seconds' : 'Off', run: () => move(1), adjust: move };
  }

  function toggleRow(label, key) {
    return { label, value: pref(key) ? 'On' : 'Off', run: () => { setPref(key, !pref(key)); build(); } };
  }

  // More rows than fit: keep the focused one on screen.
  const ROW_H = 110;
  const VISIBLE = 6;
  function render() {
    CATEGORIES.forEach((c, i) => {
      toggleClass(c.el, 'focus', zone === 'cats' && i === catIndex);
      toggleClass(c.el, 'current', i === catIndex);
    });
    items.forEach((it, i) => toggleClass(it.el, 'focus', zone === 'rows' && i === index));
    const first = Math.max(0, Math.min(index - VISIBLE + 2, items.length - VISIBLE));
    setTransform(list, 'translateY(' + (-first * ROW_H) + 'px)');
  }

  async function switchServer() {
    try {
      const servers = await getServers(session.token);
      if (servers.length === 1) {
        const uri = await connect(servers[0]);
        useServer(servers[0], uri);
        restart();
        return;
      }
      router.push(ServerPicker({ servers, onDone: restart }));
    } catch (e) {
      error('server list failed', e);
    }
  }

  function doSignOut() {
    signOut();
    restart();
  }

  function restart() {
    // Rebuild from scratch: app.js decides between login and home.
    window.dispatchEvent(new Event('velox:restart'));
  }

  build();

  return {
    el,
    name: 'settings',
    onShow() { ambience.restore(); },
    onKey(action) {
      if (zone === 'cats') {
        if (action === 'up' || action === 'down') {
          const next = Math.max(0, Math.min(CATEGORIES.length - 1, catIndex + (action === 'up' ? -1 : 1)));
          if (next !== catIndex) { catIndex = next; index = 0; build(); }
          return true;
        }
        if (action === 'right' || action === 'enter') { zone = 'rows'; index = 0; render(); return true; }
        return action !== 'back';
      }
      if (action === 'up') { index = Math.max(0, index - 1); render(); return true; }
      if (action === 'down') { index = Math.min(items.length - 1, index + 1); render(); return true; }
      if (action === 'enter') { items[index].run(); return true; }
      if ((action === 'left' || action === 'right') && items[index].adjust) {
        items[index].adjust(action === 'left' ? -1 : 1);
        return true;
      }
      if (action === 'left' || action === 'back') { zone = 'cats'; render(); return true; }
      return true;
    },
  };
}
