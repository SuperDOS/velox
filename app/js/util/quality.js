// Streaming quality: Original plays the file as is (converting only what the
// TV can't decode); the others cap the bitrate, so Plex converts the video
// when the file is bigger. Auto picks by where the server is.
export const QUALITIES = [
  { id: 'auto', label: 'Auto' },
  { id: 'original', label: 'Original' },
  { id: 20000, label: '20 Mbps 1080p', resolution: '1920x1080' },
  { id: 12000, label: '12 Mbps 1080p', resolution: '1920x1080' },
  { id: 8000, label: '8 Mbps 1080p', resolution: '1920x1080' },
  { id: 4000, label: '4 Mbps 720p', resolution: '1280x720' },
  { id: 2000, label: '2 Mbps 720p', resolution: '1280x720' },
  { id: 1000, label: '1 Mbps 480p', resolution: '854x480' },
];

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
export function streamLimit(id, uri) {
  const kind = connectionKind(uri);
  let q = QUALITIES.find(x => x.id === id) || QUALITIES[0];
  let label = q.label;
  if (q.id === 'auto') {
    q = QUALITIES.find(x => x.id === (kind === 'local' ? 'original' : kind === 'relay' ? 2000 : 8000));
    label = 'Auto (' + q.label + ')';
  }
  return { kbps: q.id === 'original' ? 0 : q.id, resolution: q.resolution || '3840x2160', remote: kind !== 'local', label };
}
