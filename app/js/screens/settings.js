// Account, server and diagnostics.
import { DEV, VERSION } from '../config.js';
import { h, toggleClass, setTransform } from '../util/dom.js';
import { pref, setPref, shuffleShows, DENSITY_STEPS, AUDIO_CHANNELS, TEXT_SIZES, SKIP_STEPS, AUTOPLAY_STEPS, HOME_REFRESH_STEPS, SCREENSAVER_STEPS, STILL_WATCHING_STEPS } from '../util/prefs.js';
import { session, signOut, useServer, signIn } from '../session.js';
import { getServers, connect } from '../plex/auth.js';
import { loadHomeUsers, switchToUser, isAdmin } from '../homeUsers.js';
import { setHud, hudEnabled } from '../ui/hud.js';
import * as router from '../router.js';
import { ServerPicker } from './login.js';
import { error } from '../util/log.js';
import { clockMode } from '../util/format.js';
import { QUALITIES, qualityLabel } from '../util/quality.js';
import * as store from '../util/store.js';
import { accentName, nextAccent, accents, setAccent, accentIndex, THEMES, ROLES, themeId, themeIds, themeName, setTheme, customTheme, setCustomColor, copyIntoCustom, ambientOn, setAmbient, toHsb, fromHsb } from '../ui/theme.js';
import { useAmbience } from '../ui/backdrop.js';
import { republishPreview } from '../platform/preview.js';
import { showMenu, showPrompt } from '../ui/menu.js';
import { UI_SIZES } from '../util/screen.js';
import { showScreensaver } from '../ui/screensaver.js';
import { FOCUS_STYLES } from '../ui/focusfx.js';
import { CAROUSEL_SOURCES } from '../ui/carousel.js';

const SKIPS = { button: 'Show a button', auto: 'Skip automatically', off: 'Off' };
const DISPLAYS = { fit: 'Fit (whole picture)', stretch: 'Stretch (fill the screen)' };
const CHAPTER_MARKERS = { missing: 'When Plex has none', always: 'Always', off: 'Off' };
const SAVER_STYLES = { logo: 'Velox logo', dvd: 'DVD logo', backdrops: 'Backdrops', pipes: '3D Pipes', starfield: 'Starfield', beziers: 'Bezier curves', scenes: 'Ambient scenes' };
const SAVER_SCENES = { random: 'Random', aurora: 'Northern lights', nebula: 'Nebula', plasma: 'Plasma', fireflies: 'Fireflies' };
const TEXT_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };
const CLOCKS = { 24: '24-hour', 12: '12-hour', off: 'Off' };
const VIEWS = { grid: 'Grid', list: 'List' };
const ACTIONS = { play: 'Play', page: 'Open details' };
const SPACINGS = { tight: 'Tight', normal: 'Normal', spacious: 'Spacious' };
const EPISODE_ART = { series: 'Show poster', season: 'Season poster', thumb: 'Episode picture (wide rows)' };

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
      // A Home user who isn't the admin sees these but can't change them.
      { label: 'Server', value: session.server ? session.server.name : '—', run: isAdmin() ? switchServer : () => {} },
      // Plex Home: only when the Home has more than one user.
      ...(home.length > 1 ? [
        { label: 'User', value: session.user ? session.user.title : '—', action: 'Switch', run: pickUser },
        ...(isAdmin() ? [toggleRow('Choose user at start', 'pickUserAtStart')] : []),
      ] : []),
      isAdmin() ? { label: 'Signed in as', value: session.user ? session.user.title : '—', run: doSignOut, action: 'Sign out' }
        : { label: 'Signed in as', value: session.user ? session.user.title : '—', run: () => {} },
    ] },
    { name: 'Theme', rows: themeRows },
    { name: 'Appearance', rows: () => [
      { heading: 'Size and text' },
      // Takes a restart to lay everything out again; OK applies the choice.
      { label: 'Interface size', value: UI_SIZES[pendingSize] + (pendingSize !== Number(pref('uiSize')) ? '  ·  OK restarts the app' : ''),
        adjust: dir => { const k = Object.keys(UI_SIZES).map(Number).sort((a, b) => b - a); pendingSize = k[Math.max(0, Math.min(k.length - 1, k.indexOf(pendingSize) + dir))]; build(); },
        run: () => { if (pendingSize !== Number(pref('uiSize'))) { setPref('uiSize', pendingSize); location.reload(); } } },
      { label: 'Text size', value: TEXT_LABELS[pref('textSize')] || 'Medium', run: () => moveTextSize(1), adjust: moveTextSize },
      { label: 'Clock', value: CLOCKS[clockMode()], run: () => { store.set('clock', { 24: '12', 12: 'off', off: '24' }[clockMode()]); build(); } },
      ...(clockMode() !== 'off' ? [toggleRow('Clock on detail pages', 'clockOnDetails')] : []),
      { heading: 'Tiles' },
      cycleRow('Focus style', 'focusStyle', FOCUS_STYLES),
      toggleRow('Focus animation', 'focusAnimation'),
      toggleRow('Border glow', 'focusGlow'),
      { label: 'Poster corners', value: pref('tileCorners') === 'square' ? 'Square' : 'Rounded',
        run: () => { setPref('tileCorners', pref('tileCorners') === 'square' ? 'rounded' : 'square'); build(); } },
      { label: 'Watched badges', value: pref('badgeStyle') === 'box' ? 'Corner box' : 'Rounded',
        run: () => { setPref('badgeStyle', pref('badgeStyle') === 'box' ? 'pill' : 'box'); build(); } },
      { label: 'Cast photos', value: pref('castShape') === 'rounded' ? 'Rounded squares' : 'Circles',
        run: () => { setPref('castShape', pref('castShape') === 'rounded' ? 'round' : 'rounded'); build(); } },
      { heading: 'Extras' },
      toggleRow('Velox logo on Home', 'homeLogo'),
      toggleRow('Startup animation', 'startupAnimation'),
      toggleRow('Theme music', 'themeMusic'),
    ] },
    { name: 'Home', rows: () => [
      { heading: 'Start' },
      { label: 'Start on', value: startLabel(), run: () => pickStart() },
      toggleRow('Featured carousel', 'heroCarousel'),
      ...(pref('heroCarousel') ? [cycleRow('Carousel shows', 'carouselSource', CAROUSEL_SOURCES)] : []),
      toggleRow('Explore in the top bar', 'showExplore'),
      { heading: 'Rows' },
      toggleRow('Hide watched on Home', 'homeHideWatched'),
      refreshRow(),
      { label: 'Home Shuffle button', value: shuffleLabel(), run: () => pickShuffle() },
      { label: 'Home-bar tiles', value: pref('previewTiles') === 'poster' ? 'Posters' : 'Wide',
        run: () => { setPref('previewTiles', pref('previewTiles') === 'poster' ? 'wide' : 'poster'); republishPreview(); build(); } },
      { heading: 'Pressing OK' },
      { label: 'Continue Watching action', value: ACTIONS[pref('continueWatching')] || ACTIONS.page,
        run: () => { setPref('continueWatching', pref('continueWatching') === 'play' ? 'page' : 'play'); build(); } },
      { label: 'Episode action', value: ACTIONS[pref('episodeAction')] || ACTIONS.page,
        run: () => { setPref('episodeAction', pref('episodeAction') === 'play' ? 'page' : 'play'); build(); } },
    ] },
    { name: 'Library', rows: () => [
      { heading: 'Layout' },
      cycleRow('View', 'libraryView', VIEWS),
      { label: 'Columns', value: pref('libraryDensity') + ' per row', run: () => moveDensity(1), adjust: moveDensity },
      cycleRow('Spacing', 'gridSpacing', SPACINGS),
      { heading: 'Episodes' },
      cycleRow('Episode artwork', 'episodeArt', EPISODE_ART),
      toggleRow('Episode numbers on tiles', 'showEpisodeNumber'),
      toggleRow('Hide summaries of unwatched episodes', 'hideSpoilers'),
      { heading: 'Badges' },
      toggleRow('Watched marks', 'showWatched'),
      toggleRow('Unwatched counts', 'showUnwatchedCount'),
      { heading: 'Ratings' },
      cycleRow('Rating logos', 'ratingLogos', { colour: 'Colour', mono: 'One colour' }),
      toggleRow('Oscars', 'showOscars'),
    ] },
    { name: 'Playback', rows: () => [
      { heading: 'Picture' },
      { label: 'Streaming quality', value: qualityLabel(pref('quality')), run: () => moveQuality(1), adjust: moveQuality },
      cycleRow('Display', 'displayMode', DISPLAYS),
      cycleRow('Audio channels', 'audioChannels', AUDIO_CHANNELS),
      { heading: 'Jumping' },
      stepRow('Skip back', 'skipBack'),
      stepRow('Skip forward', 'skipForward'),
      { heading: 'Intro and credits' },
      cycleRow('Skip intro', 'introSkip', SKIPS),
      cycleRow('Skip credits', 'credits', SKIPS),
      cycleRow('From chapter names', 'chapterMarkers', CHAPTER_MARKERS),
      ...(pref('chapterMarkers') === 'off' ? [] : [patternRow('Intro chapter pattern', 'introPattern'), patternRow('Credits chapter pattern', 'creditsPattern')]),
      { heading: 'Up next' },
      autoplayRow(),
      stillWatchingRow(),
    ] },
    { name: 'Screensaver', rows: () => [
      screensaverRow(),
      { label: 'Style', value: SAVER_STYLES[pref('screensaverLogo')] || 'Velox logo', run: () => moveSaverStyle(1), adjust: moveSaverStyle },
      ...(pref('screensaverLogo') === 'backdrops' ? [toggleRow('Title and clock', 'screensaverText')] : []),
      ...(pref('screensaverLogo') === 'scenes' ? [{ label: 'Scene', value: SAVER_SCENES[pref('screensaverScene')] || 'Random', run: () => moveSaverScene(1), adjust: moveSaverScene }] : []),
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
    if (items[index] && items[index].heading) index = nextRow(index, 1);
    items.forEach(it => {
      if (it.heading) { it.el = h('div', 'setting-head', list); it.el.textContent = it.heading; return; }
      it.el = h('div', 'setting', list);
      h('span', 'setting-label', it.el).textContent = it.label;
      const value = h('span', 'setting-value', it.el);
      h('span', '', value).textContent = it.value + (it.action ? '  ·  ' + it.action : '');
      if (it.slider) {
        // A colour track under the row with a marker at the value (Hue, Saturation, Brightness).
        const bar = h('i', 'setting-bar', it.el);
        bar.style.background = it.slider.track;
        h('i', 'setting-thumb', bar).style.left = (it.slider.pos * 100).toFixed(1) + '%';
      }
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

  // Settings → Theme. Presets switch on ◀▶ (live). Custom adds an editor: pick
  // a colour with ◀▶ on "Edit", then Hue, Saturation and Brightness on ◀▶
  // (the screen itself is the preview), or copy a preset in with "Start from".
  let pendingSize = UI_SIZES[pref('uiSize')] ? Number(pref('uiSize')) : 100; // Interface size, before OK
  let editRole = 'bg';
  let copyFrom = 'velox';
  const HSB_STEP = { h: 10, s: 5, b: 2 };
  const HSB_MAX = { h: 360, s: 100, b: 100 };
  // The exact values being edited: re-deriving them from the rounded hex each
  // step would drift (and lose the hue of a grey).
  let editing = { role: '', hex: '', hsb: null };
  function themeRows() {
    const ids = themeIds();
    const moveTheme = dir => { setTheme(ids[(ids.indexOf(themeId()) + dir + ids.length) % ids.length]); build(); };
    const rows = [
      { heading: 'Colours' },
      { label: 'Theme', value: themeName(), run: () => moveTheme(1), adjust: moveTheme },
      { label: 'Background', value: ambientOn() ? 'Artwork colours' : 'Theme colour', run: () => { setAmbient(!ambientOn()); build(); } },
      // ◀▶ picks a swatch (live preview), OK cycles.
      { label: 'Accent colour', value: accentName(), swatches: accents(), run: () => { nextAccent(); build(); },
        adjust: dir => { setAccent(accentIndex() + dir); build(); } },
    ];
    if (themeId() !== 'custom') {
      rows.push({ label: 'Customise', value: 'Make your own from ' + themeName(), run: () => { setTheme('custom'); build(); } });
      return rows;
    }
    const c = customTheme();
    const roles = Object.keys(ROLES);
    const moveRole = dir => { editRole = roles[(roles.indexOf(editRole) + dir + roles.length) % roles.length]; build(); };
    rows.push({ heading: 'Custom colours' });
    rows.push({ label: 'Edit', value: ROLES[editRole] + '  ' + c[editRole], run: () => moveRole(1), adjust: moveRole,
      swatches: roles.map(r => ({ hex: c[r], on: r === editRole })) });
    if (editing.role !== editRole || editing.hex !== c[editRole]) editing = { role: editRole, hex: c[editRole], hsb: toHsb(c[editRole]) };
    const hsb = editing.hsb;
    // Each slider's track shows what moving along it does to the colour.
    const tracks = {
      h: 'linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
      s: 'linear-gradient(90deg, ' + fromHsb({ h: hsb.h, s: 0, b: hsb.b }) + ', ' + fromHsb({ h: hsb.h, s: 100, b: hsb.b }) + ')',
      b: 'linear-gradient(90deg, #000, ' + fromHsb({ h: hsb.h, s: hsb.s, b: 100 }) + ')',
    };
    [['h', 'Hue', v => v + '°'], ['s', 'Saturation', v => v + '%'], ['b', 'Brightness', v => v + '%']].forEach(([k, label, fmt]) => {
      const move = dir => {
        const next = Object.assign({}, hsb);
        next[k] = k === 'h' ? (hsb.h + dir * HSB_STEP.h + 360) % 360 : Math.max(0, Math.min(HSB_MAX[k], hsb[k] + dir * HSB_STEP[k]));
        const hex = fromHsb(next);
        editing = { role: editRole, hex, hsb: next };
        setCustomColor(editRole, hex);
        build();
      };
      rows.push({ label, value: fmt(hsb[k]), run: () => move(1), adjust: move, slider: { pos: hsb[k] / HSB_MAX[k], track: tracks[k] } });
    });
    const presets = Object.keys(THEMES);
    const moveCopy = dir => { copyFrom = presets[(presets.indexOf(copyFrom) + dir + presets.length) % presets.length]; build(); };
    rows.push({ label: 'Start from', value: THEMES[copyFrom].name, action: 'OK copies its colours', adjust: moveCopy,
      swatches: ['bg', 'surface', 'text', 'accent'].map(r => ({ hex: THEMES[copyFrom][r] })),
      run: () => { copyIntoCustom(copyFrom); build(); } });
    return rows;
  }

  // A regular expression matched (ignoring case) against chapter names. Typed
  // with the on-screen keyboard; empty goes back to the default.
  function patternRow(label, key) {
    const edit = async (title = label) => {
      const text = await showPrompt({ title, value: pref(key), placeholder: 'Empty: the default pattern' });
      if (text === null) return;
      if (text) {
        try { new RegExp(text, 'i'); } catch (e) { edit('Not a valid pattern, try again'); return; }
      }
      setPref(key, text || undefined);
      build();
    };
    const v = pref(key);
    return { label, value: v.length > 34 ? v.slice(0, 33) + '…' : v, run: () => edit() };
  }

  // Steps a pref through the keys of a { value: label } map, wrapping around.
  function cycle(key, map, dir) {
    const keys = Object.keys(map);
    const i = Math.max(0, keys.indexOf(String(pref(key))));
    setPref(key, keys[(i + dir + keys.length) % keys.length]);
    build();
  }
  function cycleRow(label, key, map) {
    return { label, value: map[pref(key)] || map[Object.keys(map)[0]], run: () => cycle(key, map, 1), adjust: dir => cycle(key, map, dir) };
  }
  const moveSaverScene = dir => cycle('screensaverScene', SAVER_SCENES, dir);
  const moveSaverStyle = dir => cycle('screensaverLogo', SAVER_STYLES, dir);

  function moveDensity(dir) {
    const i = Math.max(0, DENSITY_STEPS.indexOf(pref('libraryDensity')));
    setPref('libraryDensity', DENSITY_STEPS[Math.max(0, Math.min(DENSITY_STEPS.length - 1, i + dir))]);
    build();
  }

  // Home, or a library to open at launch (Back from it goes to Home).
  let sectionList = null;
  function startLabel() {
    const s = pref('startupSection');
    if (!s || s === 'home') return 'Home';
    if (s === 'explore') return 'Explore';
    const found = (sectionList || []).find(x => x.key === s.key);
    return (found || s).title || 'Home';
  }
  async function pickStart() {
    try {
      if (!sectionList) sectionList = await session.server.sections();
    } catch (e) {
      error('sections for startup failed', e);
      sectionList = [];
    }
    const cur = pref('startupSection');
    const set = v => { setPref('startupSection', v); build(); };
    const items = [{ label: 'Home', on: !cur || cur === 'home', run: () => set('home') },
      { label: 'Explore', on: cur === 'explore', run: () => set('explore') }]
      .concat(sectionList.map(s => ({ label: s.title, on: cur && cur.key === s.key, run: () => set({ key: s.key, title: s.title, type: s.type }) })));
    showMenu({ title: 'Start on', items });
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

  // Section headings aren't stops: ▲▼ skip them.
  function nextRow(i, dir) {
    let j = i + dir;
    while (items[j] && items[j].heading) j += dir;
    return items[j] ? j : i;
  }
  const firstRow = () => nextRow(-1, 1);

  // More rows than fit the clip (its height follows the screen): keep the
  // focused row, and the heading just above it, in view.
  let scrollY = 0;
  function render() {
    CATEGORIES.forEach((c, i) => {
      toggleClass(c.el, 'focus', zone === 'cats' && i === catIndex);
      toggleClass(c.el, 'current', i === catIndex);
    });
    items.forEach((it, i) => toggleClass(it.el, 'focus', zone === 'rows' && i === index));
    const it = items[index];
    if (!it || !it.el) return;
    const room = clip.clientHeight - 20;
    const prev = items[index - 1];
    const top = prev && prev.heading ? prev.el.offsetTop : it.el.offsetTop;
    const bottom = it.el.offsetTop + it.el.offsetHeight;
    if (zone !== 'rows' || index === firstRow()) scrollY = 0;
    else if (top < scrollY) scrollY = top;
    else if (bottom > scrollY + room) scrollY = bottom - room;
    scrollY = Math.max(0, Math.min(scrollY, list.offsetHeight - room));
    setTransform(list, 'translateY(' + (-scrollY) + 'px)');
  }

  // Plex Home users (listed with the token the account signed in with).
  let home = [];
  loadHomeUsers().then(users => { home = users; if (catIndex === 0) build(); }, () => {});

  function pickUser() {
    const me = session.user && session.user.uuid;
    showMenu({
      title: 'Switch user', subtitle: 'Each user has their own watch history and Continue Watching',
      items: home.map(u => ({ label: u.title + (u.protected ? '  ·  PIN' : '') + (u.admin ? '  ·  admin' : ''), on: u.uuid === me, run: () => switchUser(u) })),
    });
  }

  async function switchUser(u) {
    let pin;
    if (u.protected) {
      pin = await showPrompt({ title: 'PIN for ' + u.title, placeholder: 'PIN', secret: true });
      if (pin === null) return;
    }
    try {
      await switchToUser(u, pin);
      restart();
    } catch (e) {
      error('switch user failed', e);
      const wrongPin = e.status === 401 || e.status === 403;
      showMenu({ title: wrongPin ? 'Wrong PIN' : 'Couldn\'t switch user', subtitle: wrongPin ? '' : e.message, items: [{ label: 'OK', run: () => {} }] });
    }
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
        if (action === 'right' || action === 'enter') { zone = 'rows'; index = firstRow(); render(); return true; }
        return action !== 'back';
      }
      if (action === 'up') { index = nextRow(index, -1); render(); return true; }
      if (action === 'down') { index = nextRow(index, 1); render(); return true; }
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
