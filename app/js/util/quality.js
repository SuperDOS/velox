// Streaming quality: Original plays the file as is (converting only what the
// TV can't decode); the others cap the bitrate, so Plex converts the video
// when the file is bigger. Auto picks by where the server is.
// The ladder is Plex's own. `more` rungs appear only in the player's list for a
// video (Settings keeps the short list).
export const LADDER = [
  { id: 20000, label: '20 Mbps 1080p', resolution: '1920x1080' },
  { id: 12000, label: '12 Mbps 1080p', resolution: '1920x1080' },
  { id: 10000, label: '10 Mbps 1080p', resolution: '1920x1080', more: true },
  { id: 8000, label: '8 Mbps 1080p', resolution: '1920x1080' },
  { id: 4000, label: '4 Mbps 720p', resolution: '1280x720' },
  { id: 3000, label: '3 Mbps 720p', resolution: '1280x720', more: true },
  { id: 2000, label: '2 Mbps 720p', resolution: '1280x720' },
  { id: 1500, label: '1.5 Mbps 480p', resolution: '854x480', more: true },
  { id: 1000, label: '1 Mbps 480p', resolution: '854x480' },
  { id: 720, label: '0.7 Mbps 328p', resolution: '576x328', more: true },
  { id: 320, label: '0.3 Mbps 240p', resolution: '426x240', more: true },
];
export const QUALITIES = [
  { id: 'auto', label: 'Auto' },
  { id: 'original', label: 'Original' },
].concat(LADDER.filter(q => !q.more));

// 'convert' (the player's Convert automatically) measures the link to the
// server and takes the best rung it can carry, or the original when that fits.
export const CONVERT = 'convert';
const HEADROOM = 0.7; // of the measured speed; the rest covers peaks and Wi-Fi dips

const mbps = kbps => (kbps >= 1000 ? Math.round(kbps / 100) / 10 + ' Mbps' : kbps + ' kbps');

// The rungs worth offering for a file: below its bitrate and no wider than it.
export function rungsFor(media) {
  const bitrate = (media && media.bitrate) || 0;
  const width = (media && media.width) || 0;
  return LADDER.filter(q => (!bitrate || q.id < bitrate) && (!width || parseInt(q.resolution, 10) <= Math.max(width, 426)));
}

// "Original (720p · 4.7 Mbps)"
export function originalLabel(media) {
  const res = media && media.videoResolution;
  const bits = [res ? (/^\d+$/.test(res) ? res + 'p' : String(res).toUpperCase()) : '', media && media.bitrate ? mbps(media.bitrate) : ''].filter(Boolean);
  return 'Original' + (bits.length ? ' (' + bits.join(' · ') + ')' : '');
}

// What a measured link speed (kbps) allows for a file: 0 for the original,
// else the cap of the best rung that fits (the lowest rung if none does).
export function convertCap(media, linkKbps) {
  const room = linkKbps * HEADROOM;
  if (!media || !media.bitrate || media.bitrate <= room) return 0;
  const rungs = rungsFor(media);
  const best = rungs.find(q => q.id <= room) || rungs[rungs.length - 1];
  return best ? best.id : 0;
}

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/;

// 'local', 'remote' or 'relay', from the server URL we connected with. Plex's
// HTTPS addresses carry the IP in the name (10-0-0-5.<id>.plex.direct); its
// relays answer on port 8443.
export function connectionKind(uri) {
  const m = /^https?:\/\/([^/:]+)(?::(\d+))?/.exec(uri || '');
  if (!m) return 'local';
  let host = m[1];
  if (/\.plex\.direct$/.test(host)) host = host.split('.')[0].replace(/-/g, '.');
  if (PRIVATE.test(host) || host === 'localhost') return 'local';
  return m[2] === '8443' ? 'relay' : 'remote';
}

export function qualityLabel(id) {
  return (QUALITIES.find(q => q.id === id) || QUALITIES[0]).label;
}

// What to stream at: { kbps (0 = original), resolution, remote, label }.
// convertKbps: what Convert automatically settled on (undefined until measured).
export function streamLimit(id, uri, convertKbps) {
  const kind = connectionKind(uri);
  const find = x => QUALITIES.find(q => q.id === x) || LADDER.find(q => q.id === x);
  let q = find(id) || QUALITIES[0];
  let label = q.label;
  if (id === CONVERT) {
    q = find(convertKbps || 'original');
    label = 'Convert automatically' + (convertKbps === undefined ? '' : ' (' + q.label + ')');
  } else if (q.id === 'auto') {
    q = find(kind === 'local' ? 'original' : kind === 'relay' ? 2000 : 8000);
    label = 'Auto (' + q.label + ')';
  }
  return { kbps: q.id === 'original' ? 0 : q.id, resolution: q.resolution || '3840x2160', remote: kind !== 'local', label };
}
