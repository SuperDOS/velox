// Screensaver: after a while with no key presses, a black screen with the Velox
// logo bouncing around like the classic DVD logo, changing colour at each
// wall. Not while a video is playing (paused is fine). Any key wakes it and is
// otherwise ignored. The logo can also be the DVD one, tinted whole like the
// original: img/saver-dvd.png.
import { h } from '../util/dom.js';
import { pref } from '../util/prefs.js';
import { session } from '../session.js';
import { timeOfDay, clockMode } from '../util/format.js';
import { startPipes } from './pipes.js';
import { startStarfield } from './starfield.js';
import { startBeziers } from './beziers.js';

// The WebGL styles; each returns a stop function, or null without WebGL.
const GL_STYLES = { pipes: startPipes, starfield: startStarfield, beziers: startBeziers };

const SIZES = { logo: [460, 213], dvd: [440, 194] }; // on screen; the Velox masks are 561×260, the DVD one 685×302
let W = 460;
let H = 213;
let kind = '';
let dvd = null;
const SPEED = 150; // px per second, each axis
const COLOURS = ['#FFF7E6', '#4FC3F7', '#81C784', '#E57373', '#BA68C8', '#FF8A65', '#4DB6AC'];

let el = null;
let moverX = null;  // slides left/right
let moverY = null;  // inside it, slides up/down
let logo = null;
let keyframes = null;
let letters = null;
let logo_ = null;     // the Velox logo (wordmark + mark)
let ignoreKeysUntil = 0; // a preview ignores the key press that started it
let lastActivity = Date.now();
let running = false;
let colour = 0;
let stopPipes = null;

function build() {
  el = h('div', 'saver hidden', document.body);
  moverX = h('div', 'saver-x', el);
  moverY = h('div', 'saver-y', moverX);
  logo = h('div', 'saver-logo', moverY);
  // Each leg of either slide ends at a wall: change colour.
  moverX.addEventListener('animationiteration', bounce);
  moverY.addEventListener('animationiteration', bounce);
  keyframes = h('style', '', document.head);
  logo_ = h('div', 'saver-velox', logo);
  letters = h('div', 'saver-letters', logo_);
  h('div', 'saver-chevron', logo_);
  dvd = h('div', 'saver-dvd', logo);
}

function setKind(k) {
  kind = k === 'dvd' ? 'dvd' : 'logo';
  [W, H] = SIZES[kind];
  if (kind === 'dvd' && !dvd.firstChild) h('div', 'saver-dvd-img', dvd);
  logo.style.width = W + 'px';
  logo.style.height = H + 'px';
  logo_.style.display = kind === 'logo' ? '' : 'none';
  dvd.style.display = kind === 'dvd' ? '' : 'none';
}

function bounce() {
  let c = Math.floor(Math.random() * (COLOURS.length - 1));
  if (c >= colour) c++; // never the same colour twice
  colour = c;
  if (kind === 'dvd') dvd.firstChild.style.backgroundColor = COLOURS[colour];
  else letters.style.backgroundColor = COLOURS[colour];
}

// The bounce is two CSS animations, left/right and up/down, each running
// back and forth forever. The GPU runs them off the main thread, so the
// movement stays smooth whatever the app is doing. A random negative delay
// starts each at a random point and direction.
function startBounce() {
  const dw = 1920 - W, dh = 1080 - H;
  keyframes.textContent =
    '@keyframes saver-x { from { transform: translateX(0); } to { transform: translateX(' + dw + 'px); } }' +
    '@keyframes saver-y { from { transform: translateY(0); } to { transform: translateY(' + dh + 'px); } }';
  const tx = dw / SPEED, ty = dh / SPEED;
  moverX.style.animation = 'saver-x ' + tx + 's linear ' + (-Math.random() * tx * 2) + 's infinite alternate';
  moverY.style.animation = 'saver-y ' + ty + 's linear ' + (-Math.random() * ty * 2) + 's infinite alternate';
}

function stopBounce() {
  if (moverX) { moverX.style.animation = 'none'; moverY.style.animation = 'none'; }
}

function start() {
  if (!el) build();
  running = true;
  if (pref('screensaverLogo') === 'backdrops') { startBackdrops(); return; }
  const glStyle = GL_STYLES[pref('screensaverLogo')];
  if (glStyle) {
    moverX.style.display = 'none';
    el.classList.remove('hidden');
    stopPipes = glStyle(el);
    if (stopPipes) return;
    moverX.style.display = ''; // no WebGL: fall back to the bouncing logo
  }
  moverX.style.display = '';
  setKind(pref('screensaverLogo'));
  bounce();
  el.classList.remove('hidden');
  startBounce();
}

function stop() {
  running = false;
  el.classList.add('hidden');
  stopBounce();
  stopBackdrops();
  if (stopPipes) { stopPipes(); stopPipes = null; }
}

// --- Backdrops: the library's artwork as a slow slideshow, with the title
// and the time. Each picture drifts (Ken Burns) and cross-fades to the next.

const SLIDE_MS = 12000;
let bd = null;
let slides = [];
let slidesFrom = ''; // the server id the slides came from
let slideIndex = 0;
let slideTimer = 0;

function buildBackdrops() {
  bd = h('div', 'saver-bd', el);
  bd.layers = [h('img', 'saver-bd-img', bd), h('img', 'saver-bd-img', bd)];
  bd.layers.forEach(i => { i.alt = ''; });
  bd.front = 0;
  const cap = h('div', 'saver-bd-cap', bd);
  bd.titleEl = h('div', 'saver-bd-title', cap);
  bd.sub = h('div', 'saver-bd-sub', cap);
  bd.clock = h('div', 'saver-bd-clock', bd);
}

async function loadSlides() {
  const server = session.server;
  const sections = (await server.sections()).filter(s => s.type === 'movie' || s.type === 'show');
  const lists = await Promise.all(sections.map(s => server.get('/library/sections/' + s.key + '/all', {
    type: s.type === 'movie' ? 1 : 2, sort: 'random', 'X-Plex-Container-Size': 30, excludeFields: 'summary',
  }).then(mc => mc.Metadata || []).catch(() => [])));
  const list = [].concat.apply([], lists).filter(m => m.art);
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
  slides = list;
  slidesFrom = server.id;
}

function showSlide() {
  if (!running || !slides.length || !session.server || session.server.id !== slidesFrom) return;
  const it = slides[slideIndex++ % slides.length];
  const back = bd.layers[1 - bd.front];
  back.onload = () => {
    if (!running) return;
    back.classList.remove('kb');
    void back.offsetWidth; // restart the drift
    back.classList.add('kb', 'on');
    bd.layers[bd.front].classList.remove('on');
    bd.front = 1 - bd.front;
    bd.titleEl.textContent = it.title;
    bd.sub.textContent = [it.year, it.type === 'show' && it.childCount ? it.childCount + (it.childCount === 1 ? ' season' : ' seasons') : ''].filter(Boolean).join('  ·  ');
  };
  back.src = session.server.image(it.art, 1920, 1080);
}

function tickClock() {
  bd.clock.textContent = clockMode() === 'off' ? '' : timeOfDay(new Date());
}

async function startBackdrops() {
  if (!bd) buildBackdrops();
  moverX.style.display = 'none';
  bd.style.display = '';
  bd.classList.toggle('bare', !pref('screensaverText'));
  el.classList.remove('hidden');
  tickClock();
  const server = session.server;
  if (server && (!slides.length || slidesFrom !== server.id)) { try { await loadSlides(); } catch (e) { /* stays black */ } }
  if (!running) return;
  showSlide();
  clearInterval(slideTimer);
  slideTimer = setInterval(() => { showSlide(); tickClock(); }, SLIDE_MS);
}

function stopBackdrops() {
  clearInterval(slideTimer);
  if (bd) { bd.style.display = 'none'; bd.layers.forEach(i => i.classList.remove('on', 'kb')); }
}

function idle() {
  lastActivity = Date.now();
  if (running) stop();
}

// Playing (not paused) video keeps the screen awake.
function watching() {
  return document.documentElement.classList.contains('playing') && !document.querySelector('.screen.player.paused');
}

export function initScreensaver() {
  // The TV switching away (Power, Home, Art Mode): stop at once. A running
  // animation kept the TV from finishing the switch to standby.
  document.addEventListener('visibilitychange', () => { if (document.hidden) idle(); });
  window.addEventListener('blur', idle);

  setInterval(() => {
    const minutes = pref('screensaver');
    if (running || !minutes || document.hidden) return;
    if (watching()) { lastActivity = Date.now(); return; }
    if (Date.now() - lastActivity >= minutes * 60000) start();
  }, 5000);
}

// When the remote was last used (the player's "Still watching?" check).
export function lastKeyAt() {
  return lastActivity;
}

// Called for every key: true when it only woke the screensaver.
export function wake() {
  lastActivity = Date.now();
  if (!running) return false;
  if (Date.now() < ignoreKeysUntil) return true;
  stop();
  return true;
}

// For testing: show it now.
export function showScreensaver() {
  if (running) return;
  ignoreKeysUntil = Date.now() + 700; // OK may auto-repeat
  start();
}
