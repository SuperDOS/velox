// File info: what a movie or episode's file is (container, size, bitrate,
// video, audio and subtitle streams, path), from the hold-OK menu or the
// player's Options. One section per version when there are several.
// ▲▼ scroll, Back or OK closes.
import { h, setTransform } from '../util/dom.js';
import * as router from '../router.js';
import { session } from '../session.js';
import { error } from '../util/log.js';

const mb = n => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB');
const rate = kbps => (kbps >= 1000 ? (kbps / 1000).toFixed(1) + ' Mbps' : kbps + ' kbps');
const up = s => String(s || '').toUpperCase();
function length(ms) {
  const s = Math.round(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60;
  return (hh ? hh + 'h ' : '') + mm + 'm ' + (s % 60) + 's';
}
const CHANNELS = { 1: 'Mono', 2: 'Stereo', 6: '5.1', 8: '7.1' };

function streamsOf(part, type) {
  return (part.Stream || []).filter(s => s.streamType === type);
}

function hdrOf(v) {
  if (v.DOVIPresent) return 'Dolby Vision' + (v.DOVIProfile ? ' ' + v.DOVIProfile : '');
  if (v.colorTrc === 'smpte2084') return 'HDR10';
  if (v.colorTrc === 'arib-std-b67') return 'HLG';
  return 'SDR';
}

// [{ heading, rows: [[label, value]] }] for one version.
function sections(media) {
  const part = (media.Part || [])[0] || {};
  const v = streamsOf(part, 1)[0];
  const out = [];
  out.push({ heading: 'Overview', rows: [
    ['Container', up(media.container)],
    ['Duration', media.duration ? length(media.duration) : ''],
    ['Size', part.size ? mb(part.size) : ''],
    ['Overall bitrate', media.bitrate ? rate(media.bitrate) : ''],
    ['Resolution', media.width ? media.width + '×' + media.height : ''],
    ['Aspect ratio', media.aspectRatio ? String(media.aspectRatio) : ''],
  ] });
  if (v) {
    out.push({ heading: 'Video', rows: [
      ['Codec', up(v.codec) + (v.profile ? ' · ' + v.profile : '')],
      ['Frame rate', v.frameRate ? +Number(v.frameRate).toFixed(3) + ' fps' + (/^(PAL|NTSC)$/.test(media.videoFrameRate) ? ' (' + media.videoFrameRate + ')' : '') : media.videoFrameRate || ''],
      ['Bit depth', v.bitDepth ? v.bitDepth + '-bit' : ''],
      ['Dynamic range', hdrOf(v)],
      ['Bitrate', v.bitrate ? rate(v.bitrate) : ''],
    ] });
  }
  const audio = streamsOf(part, 2);
  if (audio.length) {
    out.push({ heading: 'Audio', rows: audio.map((a, i) => ['Track ' + (i + 1),
      (a.displayTitle || [a.language, up(a.codec), CHANNELS[a.channels] || a.channels + 'ch'].filter(Boolean).join(' · '))
        + (a.bitrate ? ' · ' + rate(a.bitrate) : '')]) });
  }
  const subs = streamsOf(part, 3);
  if (subs.length) {
    out.push({ heading: 'Subtitles', rows: subs.map((s, i) => ['Track ' + (i + 1),
      (s.displayTitle || [s.language, up(s.codec)].filter(Boolean).join(' · ')) + (s.key ? ' · external' : '')]) });
  }
  out.push({ heading: 'File', rows: [
    ['Name', (part.file || '').split(/[\\/]/).pop()],
    ['Path', part.file || ''],
    ['Present', part.accessible === false || part.exists === false ? 'No (the server can\'t read it)' : 'Yes'],
  ] });
  out.forEach(s => { s.rows = s.rows.filter(r => r[1]); });
  return out.filter(s => s.rows.length);
}

// item: a movie or episode (fetched again when its streams aren't loaded).
export async function showFileInfo(item) {
  let full = item;
  const hasStreams = (item.Media || []).some(m => (m.Part || []).some(p => p.Stream));
  if (!hasStreams) {
    try { full = await session.server.metadata(item.ratingKey); } catch (e) { error('file info failed', e); return; }
  }
  const media = full.Media || [];
  if (!media.length) return;

  const el = h('div', 'menu-overlay', document.body);
  const box = h('div', 'info-box', el);
  h('div', 'menu-title', box).textContent = 'File info';
  h('div', 'menu-sub', box).textContent = full.type === 'episode'
    ? full.grandparentTitle + '  ·  S' + full.parentIndex + ' · E' + full.index + '  ' + full.title : full.title;
  const clip = h('div', 'info-clip', box);
  const track = h('div', 'info-track', clip);
  media.forEach((m, i) => {
    if (media.length > 1) h('div', 'info-version', track).textContent = 'Version ' + (i + 1);
    const chips = h('div', 'info-chips', track);
    [up(m.container), m.width ? m.width + '×' + m.height : '', up(m.videoCodec), up(m.audioCodec),
      (m.Part || [])[0] && m.Part[0].size ? mb(m.Part[0].size) : ''].filter(Boolean)
      .forEach(c => { h('span', 'flag', chips).textContent = c; });
    sections(m).forEach(sec => {
      h('div', 'info-heading', track).textContent = sec.heading;
      const grid = h('div', 'info-grid', track);
      sec.rows.forEach(([label, value]) => {
        const cell = h('div', 'info-cell' + (label === 'Path' || label === 'Name' || sec.heading === 'Audio' || sec.heading === 'Subtitles' ? ' wide' : ''), grid);
        h('div', 'info-label', cell).textContent = label;
        h('div', 'info-value', cell).textContent = value;
      });
    });
  });

  let y = 0;
  const STEP = 160;
  const close = () => { router.setModal(null); if (el.parentNode) el.parentNode.removeChild(el); };
  router.setModal({
    onKey(action) {
      if (action === 'back' || action === 'enter' || action === 'menu') { close(); return; }
      if (action === 'up' || action === 'down') {
        const max = Math.max(0, track.offsetHeight - clip.clientHeight);
        y = Math.max(0, Math.min(max, y + (action === 'down' ? STEP : -STEP)));
        setTransform(track, 'translateY(' + (-y) + 'px)');
      }
    },
  });
}
