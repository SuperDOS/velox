// Boot: restore the session and go straight to Home when we can; otherwise sign in.
import { cachedHomeUsers, loadHomeUsers } from './homeUsers.js';
import { WhosWatchingScreen } from './screens/whoswatching.js';
import { DEV, DEV_HOST, DEV_PLEX_URL, VERSION } from './config.js';
import * as router from './router.js';
import { isTizen, registerKeys } from './platform/tizen.js';
import { session, reconnect, signOut } from './session.js';
import { HomeScreen } from './screens/home.js';
import { PlayerScreen } from './screens/player.js';
import { LoginScreen } from './screens/login.js';
import { initHud } from './ui/hud.js';
import { showHomeButton } from './ui/homeButton.js';
import { log, warn } from './util/log.js';
import * as nav from './nav.js';
import * as store from './util/store.js';
import { applyTheme } from './ui/theme.js';
import { warm as warmDiscover } from './plex/discover.js';
import { readDeepLink } from './platform/preview.js';
import { applyBadgeStyle, applyTextSize, pref } from './util/prefs.js';
import { initScreensaver, wake, showScreensaver } from './ui/screensaver.js';
import { W, H, SCALE, applyScreenSize } from './util/screen.js';
import { themeState } from './ui/themeMusic.js';

function goHome() {
  router.reset(HomeScreen());
}

function goLogin() {
  router.reset(LoginScreen({ onDone: goHome }));
}

async function verify() {
  // Home already painted from cache; make sure the saved connection still works.
  try {
    await session.server.get('/identity');
  } catch (e) {
    if (e.status === 401) { signOut(); goLogin(); return; }
    warn('saved server unreachable, re-resolving', e.message);
    try {
      await reconnect();
      goHome();
    } catch (err) {
      if (err.status === 401) { signOut(); goLogin(); }
    }
  }
}

// The UI is laid out for a W×H screen (1920×1080, or bigger for a smaller
// interface size). Zoom it to fit the window (or the TV's 1920×1080) and
// center it. zoom (not a transform) re-renders text and images at the
// window's real resolution. The TV's screen is always 1920×1080, and its
// innerWidth can't be trusted: while the layout is wider than the viewport
// the browser shrinks the page itself and reports the wider size, which
// read here would undo the zoom (or apply it twice).
function fitWindow() {
  const root = document.documentElement;
  const vw = isTizen ? 1920 : innerWidth;
  const vh = isTizen ? 1080 : innerHeight;
  const s = Math.min(vw / W, vh / H);
  root.style.position = 'relative'; // so the margins below move #app too
  root.style.zoom = s;
  root.style.marginLeft = Math.max(0, (vw - W * s) / 2 / s) + 'px';
  root.style.marginTop = Math.max(0, (vh - H * s) / 2 / s) + 'px';
}

let pickedUser = false; // Who's watching? was shown (or skipped) this launch

function start() {
  // A release build installed over a dev build must not inherit its LAN shortcut.
  if (!DEV && session.token === 'lan-dev') {
    signOut();
    store.set('hud', undefined);
  }
  if (DEV && DEV_PLEX_URL && !session.token) {
    // Dev shortcut for servers that allow unauthenticated LAN access.
    store.set('token', 'lan-dev');
    store.set('user', { title: 'LAN (dev)' });
    store.set('server', { uri: DEV_PLEX_URL, token: '', name: 'Plex (LAN dev)', id: 'lan-dev' });
    location.reload();
    return;
  }
  if (session.token && session.server) {
    // Settings → Account → Choose user at start: once per launch, before Home.
    if (pref('pickUserAtStart') && !pickedUser) {
      pickedUser = true;
      const show = users => {
        if (users.length > 1) router.reset(WhosWatchingScreen(users, { onDone: start }));
        else start();
      };
      const cached = cachedHomeUsers();
      const fresh = loadHomeUsers();
      if (cached.length) { show(cached); fresh.catch(() => {}); } // fresher list for next time
      else {
        // Nothing saved yet: ask plex.tv, but don't hold up the start for long.
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), 4000));
        Promise.race([fresh.then(() => cachedHomeUsers(), () => []), timeout]).then(users => show(users || []));
      }
      return;
    }
    pickedUser = true;
    goHome();
    verify();
    openDeepLink();
  } else {
    goLogin();
  }
}

// Opened from a tile in the TV's home bar: go to that item (or play it) over Home.
async function openDeepLink() {
  const link = readDeepLink();
  if (!link || !session.server) {
    // Settings → Home → Start on: a library over Home, so Back reaches Home.
    const start = pref('startupSection');
    if (session.server && start === 'explore') nav.openExplore();
    else if (session.server && start && start.key) nav.openLibrary(start);
    return;
  }
  try {
    const item = await session.server.metadata(link.ratingKey);
    if (link.play) nav.playItem(item); else nav.openItem(item);
  } catch (e) {
    warn('deep link failed', link.ratingKey, e.message);
  }
}

export function boot() {
  applyScreenSize();
  applyTheme();
  applyBadgeStyle();
  applyTextSize();
  warmDiscover(); // plex.tv TLS takes seconds on the TV; open it early
  if (DEV) window.__ss = { router, session, nav, showScreensaver, themeState, PlayerScreen };
  log('boot', VERSION, navigator.userAgent);
  registerKeys();
  // On the TV only needed for a smaller interface size.
  if (!isTizen || SCALE !== 1) {
    fitWindow();
    if (!isTizen) window.addEventListener('resize', fitWindow);
  }
  // ▲ that a page didn't use (it's already at its top) offers the way Home.
  router.init(document.getElementById('app'), action => {
    if (action !== 'up' || !router.below()) return false;
    showHomeButton();
    return true;
  });
  router.setKeyGuard(wake);
  initScreensaver();
  initHud(() => (router.top() && router.top().name) || '');
  window.addEventListener('velox:restart', start);
  // A home-bar tile chosen while the app is already running.
  window.addEventListener('appcontrol', () => {
    if (!session.token || !session.server) return;
    goHome();
    openDeepLink();
  });
  // Dev builds only; release builds don't ship js/dev/.
  if (DEV && DEV_HOST) import('./dev/remote.js').then(m => m.startDevRemote());
  start();
  const splash = document.getElementById('splash');
  // Long enough for the startup animation to finish (it plays while Home loads).
  setTimeout(() => {
    splash.classList.add('gone');
    setTimeout(() => splash.parentNode && splash.parentNode.removeChild(splash), 400);
  }, pref('startupAnimation') ? 2000 : 500);
}
