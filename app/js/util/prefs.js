// Playback preferences (Settings → Playback), saved on this TV.
import * as store from './store.js';

const DEFAULTS = {
  skipBack: 10,          // seconds, the control left of play/pause
  skipForward: 30,       // seconds, the control right of it
  introSkip: 'button',   // intro markers: 'button' (Skip Intro), 'auto' or 'off' (older setting: autoSkipIntro)
  credits: 'button',     // credits markers: 'button' (Skip Credits), 'auto' (skip by itself) or 'off' (ignore them; the server's credits detection is often off)
  homeShuffle: 'unwatched', // home Shuffle button: 'unwatched', 'all' or { shows: [{ key, title }] }
  quality: 'auto',       // streaming quality, see util/quality.js
  screensaver: 5,        // minutes without a key press (may be fractional); 0 = off
  screensaverLogo: 'logo', // 'logo', 'dvd', 'backdrops', 'pipes', 'starfield', 'beziers' or 'scenes'
  screensaverScene: 'random', // scenes: 'random', 'aurora', 'nebula', 'plasma' or 'fireflies'
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
  heroCarousel: true,    // Home: the hero rotates through featured items until you move into the rows
  episodeAction: 'page', // OK on an episode tile (outside Continue Watching): 'page' opens it, 'play' plays
  startupSection: 'home', // 'home' or a library section key to open at launch
  libraryView: 'grid',   // libraries: 'grid' or 'list' (each library can override with its toolbar button)
  libraryDensity: 7,     // library grid columns
  gridSpacing: 'normal', // library grid gaps: 'tight', 'normal' or 'spacious'
  episodeArt: 'series',  // episodes in poster rows: 'series' poster, 'season' poster or 'thumb' (wide rows with the episode's own picture)
  showEpisodeNumber: true, // "S1 · E2" chip on episode tiles
  hideSpoilers: false,   // unwatched episodes: summaries hidden until revealed
  showWatched: true,     // check badge on watched items
  showUnwatchedCount: true, // unwatched-episode count on shows and seasons
  uiSize: 100,           // interface size in percent (util/screen.js): 100 for across the room, down to 70 up close
  castShape: 'round',    // cast & crew photos: 'round' or 'rounded' (rounded square)
  showExplore: true,     // Explore (Plex Discover suggestions) in the Home top bar
  audioChannels: 'original', // most audio channels sent to the TV: 'original', '6' (5.1) or '2' (stereo); more is converted
  displayMode: 'fit',    // video: 'fit' (whole picture, black bars) or 'stretch' (fills the screen)
  chapterMarkers: 'missing', // intro/credits from chapter names: 'missing' (when Plex has none), 'always' or 'off'
  introPattern: '(?:^|\\b)(?:intro(?:duction)?|opening)(?:\\b|$)|^op(?:\\s?\\d+)?$',
  creditsPattern: '(?:^|\\b)(?:outro|credits?|ending)(?:\\b|$)|^ed(?:\\s?\\d+)?$',
};
// Before introSkip there was an on/off autoSkipIntro.
if (store.get('pref:introSkip') === undefined && store.get('pref:autoSkipIntro') === true) store.set('pref:introSkip', 'auto');

export const SKIP_STEPS = [5, 10, 15, 30, 60];
export const AUTOPLAY_STEPS = [0, 5, 10, 15, 30];
export const STILL_WATCHING_STEPS = [0, 1, 2, 3];
export const HOME_REFRESH_STEPS = [0, 1, 2, 5, 10, 30]; // minutes
export const SCREENSAVER_STEPS = [0, 0.5, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60]; // minutes

// Read often (tiles check several per fill), so values are cached; setPref is
// the only writer. prefsVersion() changes on every write, so recycled views can
// tell their content is stale.
const cache = {};
let version = 0;
export function pref(key) {
  if (!(key in cache)) cache[key] = store.get('pref:' + key, DEFAULTS[key]);
  return cache[key];
}
export function prefsVersion() { return version; }

export const DENSITY_STEPS = [5, 6, 7, 8, 9];
export const AUDIO_CHANNELS = { original: 'Original', 6: 'Up to 5.1', 2: 'Stereo' };

// Settings → Playback → Audio channels: does a track with this many channels
// need converting? (0 / unknown channels never do.)
export function overChannelLimit(channels, setting) {
  const limit = setting === '2' ? 2 : setting === '6' ? 6 : 0;
  return !!limit && !!channels && channels > limit;
}
export const SPACING = { tight: 24, normal: 41, spacious: 60 };

// The shows the home Shuffle button mixes, if any.
export function shuffleShows() {
  const s = pref('homeShuffle');
  return (s && s.shows) || [];
}

export function setPref(key, value) {
  store.set('pref:' + key, value);
  if (value === undefined) delete cache[key]; else cache[key] = value; // undefined: back to the default
  version++;
  if (key === 'badgeStyle' || key === 'tileCorners' || key === 'castShape') applyBadgeStyle();
  if (key === 'textSize') applyTextSize();
}

// Tile looks set by classes on <html>: the watched-badge style and square corners.
export function applyBadgeStyle() {
  document.documentElement.classList.toggle('badge-box', pref('badgeStyle') === 'box');
  document.documentElement.classList.toggle('square-tiles', pref('tileCorners') === 'square');
  document.documentElement.classList.toggle('cast-squares', pref('castShape') === 'rounded');
}

// Overview text scale, read by the hero and detail styles as --ts.
export const TEXT_SIZES = { small: 0.82, medium: 0.92, large: 1 };
export function applyTextSize() {
  const v = TEXT_SIZES[pref('textSize')] || TEXT_SIZES.medium;
  document.documentElement.style.setProperty('--ts', String(v));
}
