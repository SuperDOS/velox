// How text subtitles look: shared by the player's Options and Settings →
// Playback → Subtitles. Saved as indexes in store 'subStyle', so new choices
// go at the end of each list.
import * as store from '../util/store.js';

export const SUB_SIZES = [['Small', 36], ['Medium', 46], ['Large', 58], ['Huge', 72]];
export const SUB_COLOURS = [['White', '#FFFFFF'], ['Yellow', '#FFE14D'], ['Cyan', '#7FE7FF'], ['Green', '#8CFF8C']];
export const SUB_POSITIONS = [['Bottom', 90], ['Raised', 220], ['Top', 0]];
export const SUB_BACKS = ['Outline', 'Box', 'Drop shadow', 'Light box', 'Plain'];
export const SUB_BACK_CLASS = ['', 'subs-box', 'subs-shadow', 'subs-lightbox', 'subs-plain'];
// The TV has one system font; the rest ship with the app (fonts/, SIL Open Font License).
export const SUB_FONTS = [
  ['Inter', 'Inter, sans-serif'], ['Open Sans', '"Open Sans", sans-serif'], ['TV default', 'sans-serif'],
  ['Atkinson Hyperlegible', '"Atkinson Hyperlegible", sans-serif'], ['Roboto', 'Roboto, sans-serif'], ['Lato', 'Lato, sans-serif'],
  ['Fira Sans', '"Fira Sans", sans-serif'], ['Source Serif', '"Source Serif 4", serif'], ['Merriweather', 'Merriweather, serif'],
  ['Courier Prime', '"Courier Prime", monospace'], ['Comic Neue', '"Comic Neue", sans-serif'],
];
export const SUB_WEIGHTS = [['Semibold', 600], ['Bold', 700], ['Regular', 400]];

export function loadSubStyle() {
  return Object.assign({ size: 1, colour: 0, position: 0, back: 0, font: 0, weight: 0 }, store.get('subStyle', {}));
}

export function saveSubStyle(s) {
  store.set('subStyle', s);
}
