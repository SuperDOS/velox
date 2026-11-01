// Playback preferences (Settings → Playback), saved on this TV.
import * as store from './store.js';

const DEFAULTS = {
  skipBack: 10,          // seconds, the control left of play/pause
  skipForward: 30,       // seconds, the control right of it
  autoSkipIntro: false,
  credits: 'button',     // credits markers: 'button' (Skip Credits), 'auto' (skip by itself) or 'off' (ignore them; the server's credits detection is often off)
  homeShuffle: 'unwatched', // home Shuffle button: 'unwatched', 'all' or { shows: [{ key, title }] }
  quality: 'auto',       // streaming quality, see util/quality.js
  screensaver: 5,        // minutes without a key press (may be fractional); 0 = off
  screensaverLogo: 'logo', // 'logo', 'dvd', 'backdrops', 'pipes', 'starfield' or 'beziers'
  screensaverText: true,  // backdrops: title and clock over the pictures
  textSize: 'medium',    // overview text on Home and the detail pages: 'small', 'medium' or 'large'
  themeMusic: true,      // a show's theme tune on its pages
  startupAnimation: true, // Velox logo animation while the app starts
  homeLogo: true,        // Velox logo at the left of the home top bar
  stillWatching: 2,      // hours of autoplay with no key press before asking "Still watching?"; 0 = never
  homeRefresh: 2,        // minutes between automatic refreshes of Home while it's showing; 0 = off
  homeHideWatched: false, // Home rows (except Continue Watching) leave out what you've watched
  tileCorners: 'rounded', // posters and thumbnails: 'rounded' or 'square'
  autoplay: 10,          // up-next countdown in seconds; 0 = don't play the next one by itself
  continueWatching: 'page', // OK on a Continue Watching tile: 'page' opens it, 'play' resumes
  badgeStyle: 'box',     // watched / unwatched-count badge: 'box' (Plex's corner box) or 'pill'
  previewTiles: 'wide',  // home-bar tiles: 'wide' (16:9 art) or 'poster' (2:3)
};

export const SKIP_STEPS = [5, 10, 15, 30, 60];
export const AUTOPLAY_STEPS = [0, 5, 10, 15, 30];
export const STILL_WATCHING_STEPS = [0, 1, 2, 3];
export const HOME_REFRESH_STEPS = [0, 1, 2, 5, 10, 30]; // minutes
export const SCREENSAVER_STEPS = [0, 0.5, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60]; // minutes

export function pref(key) {
  return store.get('pref:' + key, DEFAULTS[key]);
}

// The shows the home Shuffle button mixes, if any.
export function shuffleShows() {
  const s = pref('homeShuffle');
  return (s && s.shows) || [];
}

export function setPref(key, value) {
  store.set('pref:' + key, value);
  if (key === 'badgeStyle' || key === 'tileCorners') applyBadgeStyle();
  if (key === 'textSize') applyTextSize();
}

// Tile looks set by classes on <html>: the watched-badge style and square corners.
export function applyBadgeStyle() {
  document.documentElement.classList.toggle('badge-box', pref('badgeStyle') === 'box');
  document.documentElement.classList.toggle('square-tiles', pref('tileCorners') === 'square');
}

// Overview text scale, read by the hero and detail styles as --ts.
export const TEXT_SIZES = { small: 0.82, medium: 0.92, large: 1 };
export function applyTextSize() {
  const v = TEXT_SIZES[pref('textSize')] || TEXT_SIZES.medium;
  document.documentElement.style.setProperty('--ts', String(v));
}
