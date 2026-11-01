// A season's own page, like the official app: poster, show and season title,
// Resume / Play season / Shuffle / Watched, and the episodes in a grid below.
// ▼ from the buttons slides the grid up.
import { h, setText, setTransform, toggleClass, fitText } from '../util/dom.js';
import { useAmbience, HeroArt } from '../ui/backdrop.js';
import { Grid } from '../ui/grid.js';
import { session } from '../session.js';
import { clock, episodeLabel } from '../util/format.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { playItem, playEpisodes, itemMenu } from '../nav.js';
import { DetailScreen } from './detail.js';
import { error } from '../util/log.js';
import { playTheme, leaveTheme } from '../ui/themeMusic.js';

const GRID_TOP = 680;   // where the grid starts below the header
const SLIDE = 500;      // how far everything slides up when the grid is focused

export function SeasonScreen(initial) {
  const el = h('div', 'screen detail season');
  const ambience = useAmbience(initial.UltraBlurColors);
  const art = new HeroArt(el, 'hero-art detail-art');
  const body = h('div', 'season-body', el);
  const poster = h('img', 'season-poster', body);
  poster.alt = '';
  const head = h('div', 'season-head', body);
  const title = h('h1', 'detail-title', head);
  const sub = h('div', 'season-sub', head);
  const meta = h('div', 'detail-meta', head);
  const summary = h('p', 'detail-summary season-summary', head);
  const buttonsEl = h('div', 'detail-buttons', head);
  const count = h('h2', 'season-count', body);

  let season = initial;
  let episodes = [];
  let buttons = [];
  let buttonIndex = 0;
  let zone = 'buttons';
  let alive = true;
  let shown = false;
  let plays = 0; // player runs seen at the last onShow
  let visible = false;

  const grid = new Grid({
    cols: 4, kind: 'episode', top: GRID_TOP, height: 1080 - GRID_TOP + SLIDE,
    getItem: i => episodes[i],
    onSelect: ep => playItem(ep, { offset: ep.viewOffset || 0 }),
  });
  body.appendChild(grid.el);

  function next() {
    return episodes.find(e => e.viewOffset) || episodes.find(e => !e.viewCount) || episodes[0] || null;
  }

  function renderHeader() {
    const server = session.server;
    setText(title, season.parentTitle || '');
    fitText(title, 70, 42);
    setText(sub, season.title || '');
    const n = season.leafCount || episodes.length;
    setText(meta, [n + (n === 1 ? ' episode' : ' episodes'), season.year || season.parentYear].filter(Boolean).join('   ·   '));
    setText(summary, season.summary || '');
    if (season.thumb) poster.src = server.image(season.thumb, 300, 450);
    art.set(server.image(season.art || season.parentArt, 1920, 1080));
    ambience.set(season.UltraBlurColors);
  }

  function renderButtons() {
    buttonsEl.innerHTML = '';
    buttons = [];
    const add = (icon, label, run) => {
      const b = h('div', 'btn', buttonsEl);
      b.innerHTML = icon;
      h('span', '', b).textContent = label;
      buttons.push({ el: b, run });
    };
    const t = next();
    if (t) {
      if (t.viewOffset) add(icons.play, episodeLabel(t) + '  Resume ' + clock(t.viewOffset), () => playItem(t, { offset: t.viewOffset }));
      else add(icons.play, 'Play ' + episodeLabel(t), () => playItem(t, { offset: 0 }));
    }
    add(icons.play, 'Play season', () => playEpisodes(season));
    add(icons.shuffle, 'Shuffle', () => playEpisodes(season, { random: true }));
    const watched = season.leafCount && season.viewedLeafCount >= season.leafCount;
    add(watched ? icons.check : icons.uncheck, watched ? 'Watched' : 'Mark watched', toggleWatched);
    if (season.parentRatingKey) {
      add(icons.tv, 'Go to show', () => {
        // Back to the show page if that's where we came from, else open it.
        const below = router.below();
        if (below && below.name === 'detail' && below.ratingKey === season.parentRatingKey) router.back();
        else router.push(DetailScreen({ ratingKey: season.parentRatingKey, type: 'show', title: season.parentTitle }));
      });
    }
    buttonIndex = Math.min(buttonIndex, buttons.length - 1);
    renderFocus();
  }

  function renderFocus() {
    buttons.forEach((b, i) => toggleClass(b.el, 'focus', zone === 'buttons' && i === buttonIndex));
    toggleClass(el, 'in-grid', zone === 'grid');
    toggleClass(el, 'shifted', zone === 'grid');
    setTransform(body, 'translateY(' + (zone === 'grid' ? -SLIDE : 0) + 'px)');
  }

  async function load() {
    try {
      const server = session.server;
      const [full, kids] = await Promise.all([server.metadata(season.ratingKey), server.children(season.ratingKey)]);
      if (!alive) return;
      season = full || season;
      if (visible) playTheme(season);
      episodes = kids.filter(k => k.type === 'episode');
      setText(count, episodes.length + (episodes.length === 1 ? ' Episode' : ' Episodes'));
      renderHeader();
      grid.setTotal(episodes.length);
      grid.refresh();
      renderButtons();
    } catch (e) {
      error('season load failed', e);
      setText(summary, 'Couldn\'t load this season.');
    }
  }

  async function toggleWatched() {
    const server = session.server;
    const watched = season.leafCount && season.viewedLeafCount >= season.leafCount;
    try {
      if (watched) await server.unscrobble(season.ratingKey);
      else await server.scrobble(season.ratingKey);
      server.invalidate();
      await load();
    } catch (e) {
      error('toggle watched failed', e);
    }
  }

  function toGrid() {
    if (!episodes.length) return;
    zone = 'grid';
    const t = next();
    grid.focusIndex(Math.max(0, episodes.indexOf(t)));
    renderFocus();
  }

  if (season.title) renderHeader();
  renderButtons();
  load();

  return {
    el,
    name: 'season',
    onShow() {
      visible = true;
      playTheme(season);
      ambience.restore();
      // Back from the player: resume points and watched state changed.
      if (shown && router.pushCount('player') !== plays) { session.server.invalidate(); load(); }
      plays = router.pushCount('player');
      shown = true;
    },
    onKey(action) {
      if (zone === 'buttons') {
        switch (action) {
          case 'left': buttonIndex = Math.max(0, buttonIndex - 1); renderFocus(); return true;
          case 'right': buttonIndex = Math.min(buttons.length - 1, buttonIndex + 1); renderFocus(); return true;
          case 'enter': if (buttons[buttonIndex]) buttons[buttonIndex].run(); return true;
          case 'down': toGrid(); return true;
          case 'play': case 'playpause': { const t = next(); if (t) playItem(t, { offset: t.viewOffset || 0 }); return true; }
          case 'menu': itemMenu(season, { onPage: true, onChange: load }); return true;
        }
        return action !== 'back';
      }
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'down': grid.move(0, 1); return true;
        case 'up':
          if (grid.index < grid.cols) { zone = 'buttons'; renderFocus(); return true; }
          grid.move(0, -1); return true;
        case 'enter': grid.select(); return true;
        case 'play': case 'playpause': { const ep = grid.current(); if (ep) playItem(ep, { offset: ep.viewOffset || 0 }); return true; }
        case 'menu': itemMenu(grid.current(), { onChange: load }); return true;
        case 'info': if (grid.current()) router.push(DetailScreen(grid.current())); return true;
        case 'back': zone = 'buttons'; renderFocus(); return true;
      }
      return true;
    },
    onHide() { visible = false; leaveTheme(); },
    destroy() { alive = false; },
  };
}
