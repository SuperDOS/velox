// Theme music: a show's theme tune, quietly, while its show, season or
// episode page is up. Moving between pages of the same show keeps it playing;
// leaving them fades it out. Settings → Theme music turns it off.
import { session } from '../session.js';
import { pref } from '../util/prefs.js';
import { warn } from '../util/log.js';

const VOLUME = 0.35;
const FADE_MS = 800;

let audio = null;
let current = '';
let leaveTimer = 0;
let fadeTimer = 0;

function fade(to, done) {
  clearInterval(fadeTimer);
  const from = audio.volume;
  const steps = 16;
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * i / steps));
    if (i >= steps) { clearInterval(fadeTimer); if (done) done(); }
  }, FADE_MS / steps);
}

// item: a show, season or episode (its show's theme is used).
export function playTheme(item) {
  const path = item && (item.theme || item.parentTheme || item.grandparentTheme);
  clearTimeout(leaveTimer);
  if (!path || !pref('themeMusic')) { stopTheme(); return; }
  if (path === current) return;
  if (!audio) { audio = new Audio(); audio.loop = false; }
  current = path;
  audio.src = session.server.url(path);
  audio.volume = 0;
  // Stopped (or switched) before play() resolved: don't fade back in.
  audio.play().then(() => { if (current === path) fade(VOLUME); }, e => warn('theme music failed', e && e.message));
}

// A themed page went away: fade out, unless the next page plays the same theme.
export function leaveTheme() {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(stopTheme, 300);
}

// For dev tools: what's playing.
export function themeState() {
  return audio ? { current, paused: audio.paused, volume: Math.round(audio.volume * 100) / 100, time: Math.round(audio.currentTime) } : null;
}

export function stopTheme(now) {
  clearTimeout(leaveTimer);
  if (!audio || !current) return;
  current = '';
  if (now) { clearInterval(fadeTimer); audio.pause(); return; }
  fade(0, () => audio.pause());
}
