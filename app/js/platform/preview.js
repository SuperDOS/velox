// Smart Hub Preview: Continue Watching and Recently Added as tiles above the
// app in the TV's home bar. service/service.js hands them to the system;
// choosing a tile opens (or plays) the item through readDeepLink().
import { isTizen } from './tizen.js';
import { log, warn } from '../util/log.js';
import { pref } from '../util/prefs.js';

const SERVICE = 'VeloxApp01.preview';
const TILES = 12;

let last = null; // [server, hubs], so a Settings change can republish

function tile(server, item, play, poster) {
  const ep = item.type === 'episode';
  const image = poster
    ? server.image(ep ? item.grandparentThumb || item.thumb : item.thumb, 400, 600)
    : server.image(ep ? item.thumb : item.art || item.thumb, 640, 360);
  return {
    title: ep ? item.grandparentTitle : item.title,
    // Poster tiles are narrow: the episode's own title doesn't fit.
    subtitle: ep ? 'S' + item.parentIndex + ' · E' + item.index + (poster ? '' : '  ' + item.title) : String(item.year || ''),
    image_url: image,
    image_ratio: poster ? '2by3' : '16by9',
    // Selecting still plays (via action_data); is_playable would only add
    // Smart Hub's play badge over the art.
    action_data: JSON.stringify({ ratingKey: item.ratingKey, play }),
    is_playable: false,
  };
}

// hubs: Plex's home hubs, as Home loads them.
export function publishPreview(server, hubs) {
  last = [server, hubs];
  if (!isTizen) return;
  const poster = pref('previewTiles') === 'poster';
  const pick = re => hubs.find(h => re.test(h.hubIdentifier) && h.Metadata && h.Metadata.length);
  const sections = [
    [pick(/continue/) || pick(/ondeck/), 'Continue Watching', true],
    [pick(/movies?\.recent/), 'Recently Added Movies', false],
    [pick(/(tv|television|shows?)\.recent/), 'Recently Added TV', false],
  ].filter(s => s[0]).map(([hub, title, play]) => ({
    title,
    tiles: hub.Metadata.slice(0, TILES).map(it => tile(server, it, play, poster)),
  }));
  if (!sections.length) return;
  try {
    const data = [new tizen.ApplicationControlData('preview', [JSON.stringify({ sections })])];
    const ctl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/pick', null, null, null, data);
    tizen.application.launchAppControl(ctl, SERVICE,
      () => {},
      e => warn('preview service failed', e.name, e.message),
      {
        onsuccess: data => log('preview', sections.map(s => s.title + ' ' + s.tiles.length).join(', ') + ':',
          data.map(d => d.key + '=' + d.value.join(',')).join(' | ')),
        onfailure: () => warn('preview service replied with failure'),
      });
  } catch (e) {
    warn('preview publish failed', e.message);
  }
}

// Send the last tiles again (after the tile style changes in Settings).
export function republishPreview() {
  if (last) publishPreview(last[0], last[1]);
}

// The tile the app was opened from, if any: { ratingKey, play }.
export function readDeepLink() {
  if (!isTizen) return null;
  try {
    const req = tizen.application.getCurrentApplication().getRequestedAppControl();
    const d = req && req.appControl.data.find(x => x.key === 'PAYLOAD');
    if (!d) return null;
    const link = JSON.parse(JSON.parse(d.value[0]).values);
    log('deep link', JSON.stringify(link));
    return link && link.ratingKey ? link : null;
  } catch (e) {
    return null;
  }
}
