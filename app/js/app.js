// Boot: restore the session and go straight to Home when we can; otherwise sign in.
import { DEV, DEV_HOST, DEV_PLEX_URL, VERSION } from './config.js';
import * as router from './router.js';
import { isTizen, registerKeys } from './platform/tizen.js';
import { session, reconnect, signOut } from './session.js';
import { HomeScreen } from './screens/home.js';
import { LoginScreen } from './screens/login.js';
import { initHud } from './ui/hud.js';
import { log, warn } from './util/log.js';
import * as nav from './nav.js';
import * as store from './util/store.js';
import { applyAccent } from './ui/theme.js';
import { warm as warmDiscover } from './plex/discover.js';
import { readDeepLink } from './platform/preview.js';
import { applyBadgeStyle, applyTextSize, pref } from './util/prefs.js';
import { initScreensaver, wake, showScreensaver } from './ui/screensaver.js';
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

// The UI is laid out for the TV's fixed 1920×1080 viewport. In a desktop
// browser, zoom it to fit the window and center it. zoom (not a transform)
// re-renders text and images at the window's real resolution.
function fitWindow() {
  const root = document.documentElement;
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.position = 'relative'; // so the margins below move #app too
  root.style.zoom = s;
  root.style.marginLeft = Math.max(0, (innerWidth - 1920 * s) / 2 / s) + 'px';
  root.style.marginTop = Math.max(0, (innerHeight - 1080 * s) / 2 / s) + 'px';
}

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
  if (!link || !session.server) return;
  try {
    const item = await session.server.metadata(link.ratingKey);
    if (link.play) nav.playItem(item); else nav.openItem(item);
  } catch (e) {
    warn('deep link failed', link.ratingKey, e.message);
  }
}

export function boot() {
  applyAccent();
  applyBadgeStyle();
  applyTextSize();
  warmDiscover(); // plex.tv TLS takes seconds on the TV; open it early
  if (DEV) window.__ss = { router, session, nav, showScreensaver, themeState };
  log('boot', VERSION, navigator.userAgent);
  registerKeys();
  if (!isTizen) {
    fitWindow();
    window.addEventListener('resize', fitWindow);
  }
  router.init(document.getElementById('app'));
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
