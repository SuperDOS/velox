// Theme (background, raised surfaces, text) and accent colour, chosen in
// Settings → Theme. Colours land as CSS custom properties on <html>; the
// ambience behind every screen follows the theme when artwork colours are off.
import * as store from '../util/store.js';
import { setAmbienceTheme } from './backdrop.js';

const ACCENTS = [
  ['Burnt orange', '#D95F0E'],
  ['Coral', '#FF4C42'],
  ['Blue', '#3D8BFD'],
  ['Green', '#2FBF71'],
  ['Purple', '#9B6BFF'],
  ['Pink', '#FF5FA2'],
  ['White', '#F2F2F2'],
  ['Amber', '#E5A00D'],
];

// accent: picking the preset also picks this accent. ambient: whether the
// background follows the artwork (OLED keeps true black).
export const THEMES = {
  velox: { name: 'Velox', bg: '#0B0D12', surface: '#181B23', text: '#FFF7E6', accent: '#D95F0E', ambient: true },
  dark: { name: 'Dark', bg: '#121212', surface: '#1E1E1E', text: '#EDEDED', accent: '#F2F2F2', ambient: true },
  oled: { name: 'OLED', bg: '#000000', surface: '#111111', text: '#EDEDED', accent: '#F2F2F2', ambient: false },
  ember: { name: 'Ember', bg: '#130B07', surface: '#261812', text: '#FFEDE0', accent: '#FF7A3D', ambient: true },
  glacier: { name: 'Glacier', bg: '#09111A', surface: '#14212F', text: '#E8F3FF', accent: '#5AB0FF', ambient: true },
  forest: { name: 'Forest', bg: '#08110C', surface: '#132219', text: '#E8F5EC', accent: '#3FCF8E', ambient: true },
  plum: { name: 'Plum', bg: '#110A14', surface: '#221628', text: '#F7E9FA', accent: '#C77DFF', ambient: true },
};
export const ROLES = { bg: 'Background', surface: 'Surface', text: 'Text', accent: 'Accent' };

export function themeId() {
  const id = store.get('theme', 'velox');
  return id === 'custom' || THEMES[id] ? id : 'velox';
}

// The custom theme, started from whichever preset was on when it was made.
export function customTheme() {
  const c = store.get('customTheme', null);
  return c && c.bg ? c : Object.assign({}, THEMES.velox);
}

function colors() {
  const id = themeId();
  return id === 'custom' ? customTheme() : THEMES[id];
}

export function themeName() {
  return themeId() === 'custom' ? 'Custom' : THEMES[themeId()].name;
}

// Artwork colours in the background (Plex's UltraBlur), or the theme's own.
export function ambientOn() {
  return store.get('ambient', true);
}

export function setAmbient(on) {
  store.set('ambient', !!on);
  applyTheme();
}

export function applyTheme() {
  const c = colors();
  const root = document.documentElement.style;
  root.setProperty('--bg', c.bg);
  root.setProperty('--bg-rgb', triplet(c.bg));
  root.setProperty('--raised', c.surface);
  root.setProperty('--raised-rgb', triplet(c.surface));
  root.setProperty('--cream', c.text);
  root.setProperty('--cream-rgb', triplet(c.text));
  setAmbienceTheme(ambientOn() ? null : c.bg);
  applyAccent();
}

// Steps through the presets and Custom; Custom is listed once one exists or
// when cycling reaches it.
export function themeIds() {
  return Object.keys(THEMES).concat(['custom']);
}

export function setTheme(id) {
  if (id === 'custom' && !store.get('customTheme', null)) {
    // First time: start from the current preset's colours and accent.
    const from = colors();
    store.set('customTheme', Object.assign({}, from, { accent: accentHex() }));
  }
  store.set('theme', id);
  const t = id === 'custom' ? customTheme() : THEMES[id];
  store.set('accent', t.accent);
  store.set('ambient', t.ambient !== false);
  applyTheme();
}

// One colour of the custom theme (the accent goes to the accent as well).
export function setCustomColor(role, hex) {
  const c = customTheme();
  c[role] = hex;
  store.set('customTheme', c);
  if (role === 'accent') store.set('accent', hex);
  applyTheme();
}

// Copy every colour from a preset into the custom theme.
export function copyIntoCustom(id) {
  const t = THEMES[id];
  store.set('customTheme', Object.assign({}, t));
  store.set('theme', 'custom');
  store.set('accent', t.accent);
  applyTheme();
}

// --- Accent ---------------------------------------------------------------

// The accent is a preset index (older settings) or a hex colour.
function accentHex() {
  const a = store.get('accent', 0);
  if (typeof a === 'string' && /^#[0-9a-f]{6}$/i.test(a)) return a.toUpperCase();
  return (ACCENTS[a] || ACCENTS[0])[1];
}

export function applyAccent() {
  const hex = accentHex();
  const root = document.documentElement.style;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-glow', 'rgba(' + triplet(hex) + ', 0.45)');
}

// The swatches: the theme's own accent first, then the fixed ones.
function accentList() {
  const own = colors().accent;
  return [['Theme', own]].concat(ACCENTS.filter(a => a[1] !== own));
}

export function accentName() {
  const hex = accentHex();
  const found = accentList().find(a => a[1] === hex);
  return found ? found[0] : hex;
}

function current() {
  return Math.max(0, accentList().findIndex(a => a[1] === accentHex()));
}

export function nextAccent() {
  setAccent(current() + 1);
}

// For the swatches in Settings: [{ name, hex, on }].
export function accents() {
  const hex = accentHex();
  return accentList().map(([name, h]) => ({ name, hex: h, on: h === hex }));
}

export function setAccent(i) {
  const list = accentList();
  store.set('accent', list[(i + list.length) % list.length][1]);
  applyAccent();
}

export function accentIndex() {
  return current();
}

// --- Colour maths -----------------------------------------------------------

function triplet(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (n >> 16) + ', ' + (n >> 8 & 255) + ', ' + (n & 255);
}

// Hue 0–360, saturation and brightness 0–100 (HSV, as colour pickers use).
export function toHsb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }
  return { h: hue, s: Math.round(max ? d / max * 100 : 0), b: Math.round(max * 100) };
}

export function fromHsb({ h, s, b }) {
  const v = b / 100, c = v * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, bl] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = v2 => ('0' + Math.round((v2 + m) * 255).toString(16)).slice(-2);
  return ('#' + to(r) + to(g) + to(bl)).toUpperCase();
}
