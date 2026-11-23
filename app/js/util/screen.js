// The layout's size. The TV's web layer is 1920×1080; a smaller interface
// size (Settings → Appearance → Interface size) lays everything out on a
// bigger virtual screen that is then zoomed down to fit, so text and tiles
// get smaller and more fits. Layout code uses W and H, never 1920 / 1080;
// video and image-quality maths keep the real 1920×1080.
import { pref } from './prefs.js';

export const UI_SIZES = { 100: 'Large (across the room)', 90: 'Medium', 80: 'Small', 70: 'Smallest (up close)' };
const percent = UI_SIZES[pref('uiSize')] ? Number(pref('uiSize')) : 100;
export const SCALE = percent / 100;
export const W = Math.round(1920 / SCALE);
export const H = Math.round(1080 / SCALE);

export function applyScreenSize() {
  const root = document.documentElement.style;
  root.setProperty('--W', W + 'px');
  root.setProperty('--H', H + 'px');
  // Undoes the zoom for things that keep one size, such as the startup logo.
  root.setProperty('--unzoom', String(1 / SCALE));
}
