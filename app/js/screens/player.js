// Playback. Direct play whenever the TV can decode the file (hardware, zero
// server load); otherwise ask Plex for HLS with the video passed through and
// only the audio/container converted. Seeking previews locally and only
// commits once the user stops pressing, because AVPlay seeks are slow.
import { DEV } from '../config.js';
import { h, setText, setTransform, toggleClass, fitText } from '../util/dom.js';
import { createPlayer } from '../platform/player.js';
import { setScreenSaver, supports4K } from '../platform/tizen.js';
import { session } from '../session.js';
import { clock, episodeLabel, timeOfDay, uuid } from '../util/format.js';
import { QUALITIES, streamLimit, connectionKind } from '../util/quality.js';
import * as icons from '../ui/icons.js';
import * as router from '../router.js';
import { log, warn, error } from '../util/log.js';
import { parseSubtitles, CueTrack } from '../player/subtitles.js';
import * as store from '../util/store.js';
import { pref } from '../util/prefs.js';
import { stopTheme } from '../ui/themeMusic.js';
import { lastKeyAt } from '../ui/screensaver.js';
import { showMenu } from '../ui/menu.js';

// What Samsung TVs (Tizen 6.0+) decode natively. No DTS on 2018+ models.
const DIRECT = {
  container: { mp4: 1, m4v: 1, mov: 1, mkv: 1, webm: 1, ts: 1, mpegts: 1, avi: 1 },
  video: { h264: 1, hevc: 1, vp9: 1, av1: 1, mpeg4: 1, mpeg2video: 1, vc1: 1 },
  audio: { aac: 1, ac3: 1, eac3: 1, mp3: 1, mp2: 1, flac: 1, opus: 1, vorbis: 1, pcm: 1 },
};
// The cap for burning subtitles into 4K (see openStream).
const BURN_4K = { kbps: 20000, resolution: '1920x1080' };

// What Plex's transcode decision does with the video: 'copy' or 'transcode'.
function videoDecision(decision) {
  const md = ((decision.MediaContainer || {}).Metadata || [])[0];
  const p = md && md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
  const v = p && (p.Stream || []).find(s => s.streamType === 1);
  return v ? v.decision : '';
}

const TEXT_SUBS = { srt: 1, subrip: 1, ass: 1, ssa: 1, mov_text: 1, vtt: 1, webvtt: 1, smi: 1 };

// Names for subtitle search languages that may not appear among the file's own streams.
const LANGUAGES = {
  en: 'English', sv: 'Swedish', no: 'Norwegian', nb: 'Norwegian', da: 'Danish', fi: 'Finnish',
  de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', pl: 'Polish',
};
const PANEL_ROWS = 11;

const SUB_SIZES = [['Small', 36], ['Medium', 46], ['Large', 58], ['Huge', 72]];
const SUB_COLOURS = [['White', '#FFFFFF'], ['Yellow', '#FFE14D'], ['Cyan', '#7FE7FF'], ['Green', '#8CFF8C']];
const SUB_POSITIONS = [['Bottom', 90], ['Raised', 220], ['Top', 0]];
// Saved as indexes: add new choices at the end.
const SUB_BACKS = ['Outline', 'Box', 'Drop shadow', 'Light box', 'Plain'];
const SUB_BACK_CLASS = ['', 'subs-box', 'subs-shadow', 'subs-lightbox', 'subs-plain'];
// The TV has one system font (serif and monospace fall back to it too).
const SUB_FONTS = [['Inter', 'Inter, sans-serif'], ['Open Sans', '"Open Sans", sans-serif'], ['TV default', 'sans-serif']];
const SUB_WEIGHTS = [['Semibold', 600], ['Bold', 700], ['Regular', 400]];
const SYNC_STEP = 250;

const OSD_HIDE_MS = 4000;
const SEEK_COMMIT_MS = 900;
const TIMELINE_MS = 10000;

function streamsOf(part, type) {
  return (part && part.Stream || []).filter(s => s.streamType === type);
}

function isEmbeddedText(sub) {
  return !!sub && sub.index != null && !sub.key && !!TEXT_SUBS[sub.codec];
}

// External .srt/.ass/.vtt files: we fetch and draw these ourselves.
function isSidecarText(sub) {
  return !!sub && !!sub.key && !!TEXT_SUBS[sub.codec];
}

function subtitleLabel(s) {
  const title = s.displayTitle && s.displayTitle !== 'Unknown' ? s.displayTitle : (s.language || '');
  const kind = (s.codec || '').toUpperCase() + (s.key ? ' · external' : '');
  return title ? title + (s.key ? ' · external' : '') : kind || 'Subtitle';
}

function cleanSubtitle(text) {
  return String(text || '')
    .replace(/\{\\[^}]*\}/g, '')        // ASS override tags
    .replace(/<[^>]+>/g, '')            // <i>, <font> ...
    .replace(/\\N/g, '\n');
}

// queue: what plays after this (shuffle), instead of the next episode.
export function PlayerScreen(initial, { offset = null, queue = [] } = {}) {
  const el = h('div', 'screen player');
  const stage = h('div', 'player-stage', el);
  const subs = h('div', 'subs', el);
  const subsText = h('span', 'subs-text', subs);
  const spinner = h('div', 'spinner', el);
  const pauseBig = h('div', 'pause-big', el);
  pauseBig.innerHTML = icons.pause;

  const osd = h('div', 'osd', el);
  const osdTop = h('div', 'osd-top', osd);
  const osdTitle = h('div', 'osd-title', osdTop);
  const osdSub = h('div', 'osd-sub', osdTop);
  const osdBottom = h('div', 'osd-bottom', osd);
  const bar = h('div', 'osd-bar', osdBottom);
  const barFill = h('div', 'osd-fill', bar);
  const knob = h('div', 'osd-knob', bar);
  const seekLabel = h('div', 'osd-seek', knob);
  const seekThumb = h('img', 'osd-thumb', knob);
  seekThumb.alt = '';
  seekThumb.onload = () => toggleClass(seekThumb, 'on', true);
  const times = h('div', 'osd-times', osdBottom);
  const tNow = h('span', 'osd-now', times);
  const tInfo = h('span', 'osd-info', times);
  const tLeft = h('span', 'osd-left', times);
  // The control row under the seek bar; ▼ reaches it. Stop sits at the left
  // edge, the jumps and play/pause in the middle, the overlays at the right
  // (Chapters only when the file has them).
  const back = pref('skipBack');
  const forward = pref('skipForward');
  const credits = pref('credits'); // read per tick by updateSkip
  const CONTROLS = [
    { group: 'left', icon: icons.stop, run: () => exit() },
    { group: 'mid', label: '−' + back, run: () => jumpBy(-back * 1000) },
    { group: 'mid', pause: true, run: () => togglePause() },
    { group: 'mid', label: '+' + forward, run: () => jumpBy(forward * 1000) },
    { group: 'right', icon: icons.chapters, label: 'Chapters', run: () => openChapters(), hidden: true },
    { group: 'right', icon: icons.subtitles, label: 'Audio & Subtitles', run: () => openPanel() },
    { group: 'right', icon: icons.gear, label: 'Options', run: () => openOptions() },
  ];
  const PLAY_CTL = 2;
  const controls = h('div', 'osd-controls', osdBottom);
  const groups = {};
  ['left', 'mid', 'right'].forEach(g => { groups[g] = h('div', 'osd-ctl-' + g, controls); });
  const ctlEls = CONTROLS.map(c => {
    const b = h('div', 'osd-ctl', groups[c.group]);
    if (c.icon) b.innerHTML = c.icon;
    if (c.label) h('span', '', b).textContent = c.label;
    toggleClass(b, 'hidden', !!c.hidden);
    return b;
  });
  const CHAPTERS_CTL = CONTROLS.findIndex(c => c.label === 'Chapters');
  // Chapter marks on the seek bar, and the chapter strip.
  const ticks = h('div', 'osd-ticks', bar);
  const chapterStrip = h('div', 'chapters hidden', el);
  const chapterTrack = h('div', 'chapters-track', chapterStrip);

  const panel = h('div', 'tracks hidden', el);
  const upnext = h('div', 'upnext hidden', el);
  const skipBtn = h('div', 'skip hidden', el);
  const errorEl = h('div', 'player-error hidden', el);
  const infoEl = h('div', 'playback-info hidden', el);
  let infoTimer = 0;

  let item = initial;
  let media = null;
  let part = null;
  let mode = 'direct';
  let triedFallback = false;
  let openGen = 0;          // bumped per open(); a superseded one stops quietly
  let burned;               // while Plex transcodes: the subtitle burned in, or null; undefined otherwise
  let base = 0;             // HLS restarts at an offset; AVPlay time is relative to it
  let position = offset || 0;
  let duration = initial.duration || 0;
  let paused = false;
  let started = false;
  let alive = true;
  let audioStream = null;
  let subStream = null;
  let seekTarget = null;
  let seekCount = 0;
  let lastSeekAt = 0;
  let seekTimer = 0;
  let osdTimer = 0;
  let timelineTimer = 0;
  let subTimer = 0;
  let lastText = 0;
  let upnextTimer = 0;
  let nextItem = null;
  let cueTrack = null;
  let cueTimer = 0;
  let cueFor = null;
  let markers = [];
  let chapters = [];
  let chapterIndex = 0;
  let chapterTiles = [];
  let skipFor = null;
  let ctlIndex = -1;        // focused OSD control, -1 = the seek bar
  let quality = pref('quality'); // this video's; Options changes it without touching the setting
  let subDelay = 0;         // ms, positive = subtitles later
  const subStyle = Object.assign({ size: 1, colour: 0, position: 0, back: 0, font: 0, weight: 0 }, store.get('subStyle', {}));
  const playSession = uuid();

  const listener = {
    onTime(ms) {
      if (!started) return;
      position = base + ms;
      if (seekTarget == null) {
        renderProgress(position);
        updateSkip(position);
      }
    },
    onBuffering(on) { toggleClass(spinner, 'on', on); },
    onEnd() { finished(); },
    onError(msg) { failed(msg); },
    onSubtitle(text, ms) {
      clearTimeout(subTimer);
      setText(subsText, cleanSubtitle(text));
      if (ms > 0) subTimer = setTimeout(() => setText(subsText, ''), ms);
    },
  };
  let player = createPlayer(stage, listener);

  // --- OSD --------------------------------------------------------------

  const long = () => duration >= 3600000;

  function renderProgress(ms) {
    const p = duration ? Math.max(0, Math.min(1, ms / duration)) : 0;
    setTransform(barFill, 'scaleX(' + p.toFixed(4) + ')');
    setTransform(knob, 'translateX(' + Math.round(p * 1728) + 'px)');
    const now = Date.now();
    if (now - lastText > 900 || seekTarget != null) {
      lastText = now;
      setText(tNow, clock(ms, long()));
      setText(tLeft, '−' + clock(duration - ms, long()));
      setText(tInfo, 'Ends at ' + timeOfDay(new Date(now + (duration - ms))));
    }
  }

  function showOsd(sticky) {
    toggleClass(el, 'osd-on', true);
    renderControls();
    clearTimeout(osdTimer);
    if (!sticky && !paused) osdTimer = setTimeout(hideOsd, OSD_HIDE_MS);
  }

  function hideOsd() {
    clearTimeout(osdTimer);
    toggleClass(el, 'osd-on', false);
    ctlIndex = -1;
    renderControls();
  }

  function renderControls() {
    ctlEls.forEach((c, i) => toggleClass(c, 'focus', i === ctlIndex));
    const icon = paused ? icons.play : icons.pause;
    const pe = ctlEls[PLAY_CTL];
    if (pe._icon !== icon) { pe._icon = icon; pe.innerHTML = icon; }
  }

  // --- Subtitle look and sync --------------------------------------------

  function applySubStyle() {
    subs.style.fontSize = SUB_SIZES[subStyle.size][1] + 'px';
    subs.style.color = SUB_COLOURS[subStyle.colour][1];
    const pos = SUB_POSITIONS[subStyle.position][1];
    toggleClass(subs, 'subs-top', !pos);
    subs.style.setProperty('--sub-bottom', (pos || 90) + 'px');
    subs.style.fontFamily = SUB_FONTS[subStyle.font][1];
    subs.style.fontWeight = SUB_WEIGHTS[subStyle.weight][1];
    SUB_BACK_CLASS.forEach((c, i) => { if (c) toggleClass(subs, c, i === subStyle.back); });
  }
  applySubStyle();

  function applySync() {
    player.setSubtitleDelay(subDelay);
  }

  function syncLabel() {
    return (subDelay > 0 ? '+' : subDelay < 0 ? '−' : '') + (Math.abs(subDelay) / 1000).toFixed(2) + ' s';
  }

  function setDelay(ms) {
    subDelay = ms;
    if (part) store.set('subDelay:' + part.id, subDelay || undefined);
    applySync();
  }

  function renderTitles() {
    if (item.type === 'episode') {
      setText(osdTitle, item.grandparentTitle);
      setText(osdSub, episodeLabel(item) + '   ' + item.title);
    } else {
      setText(osdTitle, item.title);
      setText(osdSub, item.year || '');
    }
    fitText(osdTitle, 50, 32);
  }

  // --- Timeline ---------------------------------------------------------

  function report(state) {
    if (!item.ratingKey) return;
    if (DEV && window.__ss && window.__ss.muteTimeline) return;
    session.server.timeline({
      ratingKey: item.ratingKey,
      key: '/library/metadata/' + item.ratingKey,
      state,
      time: Math.floor(position),
      duration: Math.floor(duration),
      'X-Plex-Session-Identifier': playSession,
    });
  }

  function startTimeline() {
    clearInterval(timelineTimer);
    timelineTimer = setInterval(() => report(paused ? 'paused' : 'playing'), TIMELINE_MS);
  }

  // --- Opening ----------------------------------------------------------

  function decideMode() {
    // Trailers and other extras live on Plex's CDN behind a redirect AVPlay
    // can't play; let the server stream them.
    if (part.key.indexOf('/services/') === 0) return 'hls';
    const directOk = DIRECT.container[media.container] && DIRECT.video[media.videoCodec] &&
      (!audioStream || !!playedAudio());
    const subsOk = !subStream || isEmbeddedText(subStream) || isSidecarText(subStream);
    // Over the quality cap: Plex converts it down.
    const limit = streamLimit(quality, session.server.uri);
    const fits = !limit.kbps || !media.bitrate || media.bitrate <= limit.kbps;
    return directOk && subsOk && fits ? 'direct' : 'hls';
  }

  // The audio track direct play uses: the chosen one, or when the TV can't
  // decode that (TrueHD, DTS) another track of the same language it can, as
  // remuxes usually carry an AC3/EAC3 one. Converting the file instead means
  // Plex remuxing the whole video, which a 4K file at 30+ Mbps can't keep up with.
  function playedAudio() {
    if (!audioStream || DIRECT.audio[audioStream.codec]) return audioStream;
    return streamsOf(part, 2).find(s => DIRECT.audio[s.codec] && s.languageCode === audioStream.languageCode &&
      !/commentary/i.test((s.title || '') + ' ' + (s.displayTitle || ''))) || null;
  }

  // A seek, track or quality change can start a new open while one is still
  // waiting on the server or AVPlay; only the latest may touch the player.
  async function open(atMs) {
    const gen = ++openGen;
    try {
      await openStream(atMs, gen);
    } catch (e) {
      if (gen === openGen) throw e;
    }
  }

  async function openStream(atMs, gen) {
    const server = session.server;
    const t0 = Date.now();
    started = false;
    toggleClass(spinner, 'on', true);
    let url;
    let seekTo = atMs;      // where AVPlay seeks once prepared (0: already there)
    let uhd = media.videoResolution === '4k' && supports4K();
    if (mode === 'direct') {
      base = 0;
      url = server.url(part.key);
      if (burned !== undefined) server.stopTranscode(playSession);
      burned = undefined;
    } else {
      // Burn in only what we can't draw ourselves (image subs, embedded text).
      // Burning re-encodes the picture, which the server can't do for 4K in
      // real time (the stream never starts), so 4K comes down to 1080p for it.
      let limit = streamLimit(quality, server.uri);
      const burn = subStream && !isSidecarText(subStream);
      if (burn && !limit.kbps && media.videoResolution === '4k') limit = Object.assign({}, limit, BURN_4K);
      const hlsUrl = offsetMs => server.transcodeUrl(item, {
        session: playSession, offsetMs,
        maxBitrate: limit.kbps || undefined, resolution: limit.kbps ? limit.resolution : undefined, remote: limit.remote,
        audioStreamID: audioStream && audioStream.id,
        subtitleStreamID: burn ? subStream.id : undefined,
      });
      // A new start under the same session replaces the running transcode.
      burned = burn ? subStream : null;
      url = hlsUrl(atMs);
      let decision = await server.transcodeDecision(url);
      if (!alive || gen !== openGen) return;
      // Plex's playlist always spans the whole file, the part before the
      // offset as empty segments, and AVPlay fetches those one by one before
      // it plays (blocking the page meanwhile). Copied video comes in 10 s
      // segments, few enough; converted video in 1 s ones, thousands deep into
      // a film, so that starts from 0 and seeks, which Plex follows.
      if (videoDecision(decision) === 'copy') {
        base = atMs;
        seekTo = 0;
      } else {
        base = 0;
        uhd = false;
        if (atMs > 0) {
          url = hlsUrl(0);
          decision = await server.transcodeDecision(url);
          if (!alive || gen !== openGen) return;
        }
      }
      const mc = decision.MediaContainer || {};
      if (mc.generalDecisionCode && mc.generalDecisionCode >= 2000) throw new Error(mc.generalDecisionText || 'Server refused to convert this file');
    }
    const audioCodec = mode === 'direct' && playedAudio() !== audioStream ? audioStream.codec + '→' + playedAudio().codec : audioStream && audioStream.codec;
    log('play', mode, item.title, media.container + '/' + media.videoCodec + '/' + audioCodec, (media.bitrate || '?') + 'kbps',
      'quality', streamLimit(quality, server.uri).label, 'at', clock(atMs));
    player.open(url, { uhd, aspect: mode === 'direct' ? displayAspect() : 0 });
    await player.prepare();
    if (!alive || gen !== openGen) return;
    if (mode === 'direct' && !applyTracks()) throw new Error('subtitle is past the TV\'s track limit');
    if (seekTo > 0) {
      await player.seek(seekTo);
      if (!alive || gen !== openGen) return;
    }
    applySync();
    syncSidecar();
    player.play();
    paused = false;
    started = true;
    position = atMs;
    toggleClass(el, 'paused', false);
    toggleClass(spinner, 'on', false);
    errorEl.classList.add('hidden');
    log('playing after ' + (Date.now() - t0) + 'ms (' + mode + ')');
    report('playing');
    startTimeline();
  }

  // Anamorphic video (non-square pixels, e.g. 1280x720 at 9:8) shown at its
  // real shape. Plex's HLS output already has square pixels.
  function displayAspect() {
    const v = streamsOf(part, 1)[0];
    const par = v && v.pixelAspectRatio && String(v.pixelAspectRatio).split(':').map(Number);
    if (!v || !v.width || !v.height || !par || !par[0] || !par[1] || par[0] === par[1]) return 0;
    return v.width * par[0] / par[1] / v.height;
  }

  // Map Plex's chosen streams onto AVPlay's track list (same file order;
  // AVPlay leaves out audio it can't decode, like TrueHD). False when the
  // chosen subtitle isn't there: AVPlay lists at most 32 tracks, so files
  // with dozens of subtitles lose the later ones.
  function applyTracks() {
    const t = player.tracks();
    const audio = playedAudio();
    if (audio && t.audio.length > 1) {
      const pos = streamsOf(part, 2).filter(s => DIRECT.audio[s.codec]).indexOf(audio);
      if (pos >= 0 && t.audio[pos] != null) player.selectAudio(t.audio[pos]);
    }
    if (isEmbeddedText(subStream)) {
      const pos = streamsOf(part, 3).filter(isEmbeddedText).indexOf(subStream);
      if (pos < 0 || t.text[pos] == null) return false;
      player.selectText(t.text[pos]);
    } else {
      player.selectText(null);
      setText(subsText, '');
    }
    return true;
  }

  // Start/stop drawing an external subtitle file for the current selection.
  function syncSidecar() {
    if (!isSidecarText(subStream)) {
      cueTrack = null;
      cueFor = null;
      clearInterval(cueTimer);
      if (!isEmbeddedText(subStream)) setText(subsText, '');
      return;
    }
    if (cueFor === subStream) return;
    cueFor = subStream;
    const stream = subStream;
    cueTrack = null;
    fetch(session.server.url(stream.key, { encoding: 'utf-8' }))
      .then(r => r.text())
      .then(text => {
        if (cueFor !== stream || !alive) return;
        cueTrack = new CueTrack(parseSubtitles(text, stream.codec));
        log('subtitles loaded', stream.displayTitle, cueTrack.cues.length + ' cues');
      })
      .catch(e => warn('subtitle fetch failed', e.message));
    clearInterval(cueTimer);
    cueTimer = setInterval(() => {
      if (cueTrack && started) setText(subsText, cueTrack.at(base + player.time() - subDelay));
    }, 120);
  }

  async function start() {
    try {
      const full = await session.server.metadata(item.ratingKey, { markers: true, chapters: true });
      if (!alive) return;
      item = full;
      markers = (item.Marker || []).filter(m => m.type === 'intro' || (m.type === 'credits' && credits !== 'off'));
      duration = item.duration || duration;
      setChapters(item.Chapter || []);
      media = (item.Media || [])[0];
      part = media && media.Part && media.Part[0];
      if (!part) throw new Error('No playable media');
      const audios = streamsOf(part, 2);
      audioStream = audios.find(s => s.selected) || audios[0] || null;
      subStream = streamsOf(part, 3).find(s => s.selected) || null;
      subDelay = store.get('subDelay:' + part.id, 0);
      renderTitles();
      mode = decideMode();
      if (offset == null) offset = item.viewOffset || 0;
      position = offset;
      renderProgress(position);
      showOsd();
      await open(offset);
      if (store.get('playbackInfo', false)) setInfo(true);
    } catch (e) {
      failed(e.message || String(e));
    }
  }

  function failed(msg) {
    if (!alive) return;
    if (mode === 'direct' && !triedFallback && media) {
      // The file looked direct-playable but the TV choked: let Plex convert it.
      warn('direct play failed (' + msg + '), falling back to HLS');
      triedFallback = true;
      mode = 'hls';
      open(position).catch(e => failed(e.message));
      return;
    }
    error('playback failed', msg);
    toggleClass(spinner, 'on', false);
    errorEl.classList.remove('hidden');
    setText(errorEl, 'Playback failed: ' + msg);
  }

  // --- Controls ---------------------------------------------------------

  function togglePause() {
    if (!started) return;
    if (paused) {
      player.play();
      paused = false;
      showOsd();
    } else {
      player.pause();
      paused = true;
      showOsd(true);
    }
    toggleClass(el, 'paused', paused);
    report(paused ? 'paused' : 'playing');
  }

  function seekBy(dir) {
    if (!started) return;
    const now = Date.now();
    seekCount = now - lastSeekAt < 700 ? seekCount + 1 : 0;
    lastSeekAt = now;
    const step = seekCount < 3 ? 10000 : seekCount < 8 ? 30000 : seekCount < 16 ? 60000 : 180000;
    const from = seekTarget == null ? position : seekTarget;
    seekTarget = Math.max(0, Math.min(duration - 3000, from + dir * step));
    previewAt(seekTarget);
    toggleClass(el, 'seeking', true);
    setText(seekLabel, clock(seekTarget, long()));
    renderProgress(seekTarget);
    showOsd(true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  // Preview frame over the knob while scrubbing, from the server's preview
  // thumbnails (Plex: "Generate video preview thumbnails"); one still per
  // request, fetched once the scrubbing pauses briefly.
  let thumbTimer = 0;
  function previewAt(ms) {
    if (!part || part.indexes !== 'sd') return;
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      toggleClass(seekThumb, 'on', false);
      seekThumb.src = session.server.url('/library/parts/' + part.id + '/indexes/sd/' + Math.floor(ms));
    }, 120);
  }

  // The skip controls: same deferred commit as arrow seeking, so
  // repeated presses add up before the (slow) seek happens.
  function jumpBy(ms) {
    if (!started) return;
    const from = seekTarget == null ? position : seekTarget;
    seekTarget = Math.max(0, Math.min(duration - 3000, from + ms));
    previewAt(seekTarget);
    toggleClass(el, 'seeking', true);
    setText(seekLabel, clock(seekTarget, long()));
    renderProgress(seekTarget);
    showOsd(true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  async function commitSeek() {
    clearTimeout(seekTimer);
    if (seekTarget == null) return;
    const target = seekTarget;
    seekTarget = null;
    toggleClass(el, 'seeking', false);
    showOsd();
    position = target;
    try {
      if (mode === 'direct') {
        toggleClass(spinner, 'on', true);
        await player.seek(target);
        toggleClass(spinner, 'on', false);
        if (paused) togglePause();
      } else {
        await open(target);
      }
    } catch (e) {
      warn('seek failed, reopening', e.message);
      open(target).catch(err => failed(err.message));
    }
  }

  // --- Chapters ----------------------------------------------------------
  // From the file's chapter list (the server's chapter thumbnails, when it
  // made them). The strip opens on the current chapter; OK jumps there.

  function setChapters(list) {
    chapters = list.length > 1 ? list : [];
    CONTROLS[CHAPTERS_CTL].hidden = !chapters.length;
    toggleClass(ctlEls[CHAPTERS_CTL], 'hidden', !chapters.length);
    ticks.innerHTML = '';
    if (!duration) return;
    chapters.slice(1).forEach(c => {
      const t = h('i', '', ticks);
      t.style.left = Math.round(c.startTimeOffset / duration * 1728) + 'px';
    });
  }

  function chapterAt(ms) {
    let i = 0;
    chapters.forEach((c, k) => { if (ms >= c.startTimeOffset) i = k; });
    return i;
  }

  function chapterName(c, i) {
    return c.tag || 'Chapter ' + (i + 1);
  }

  function openChapters() {
    if (!chapters.length) return;
    if (!chapterTiles.length) {
      chapterTiles = chapters.map((c, i) => {
        const t = h('div', 'chapter', chapterTrack);
        const img = h('img', '', t);
        img.alt = '';
        if (c.thumb) img.src = session.server.image(c.thumb, 352, 198);
        h('div', 'chapter-name', t).textContent = chapterName(c, i);
        h('div', 'chapter-time', t).textContent = clock(c.startTimeOffset, long());
        return t;
      });
    }
    chapterIndex = chapterAt(seekTarget == null ? position : seekTarget);
    renderChapters();
    chapterStrip.classList.remove('hidden');
    hideOsd();
  }

  const CHAPTER_STEP = 376; // tile width + gap
  function renderChapters() {
    chapterTiles.forEach((t, i) => toggleClass(t, 'focus', i === chapterIndex));
    // Keep the focused tile in view, starting to scroll from the third.
    const shift = Math.max(0, Math.min(chapterIndex - 2, chapters.length - 5)) * CHAPTER_STEP;
    setTransform(chapterTrack, 'translateX(' + -shift + 'px)');
  }

  function closeChapters() {
    chapterStrip.classList.add('hidden');
  }

  function chapterKey(action) {
    switch (action) {
      case 'left': case 'right':
        chapterIndex = Math.max(0, Math.min(chapters.length - 1, chapterIndex + (action === 'left' ? -1 : 1)));
        renderChapters();
        return true;
      case 'enter':
        closeChapters();
        goToChapter(chapterIndex);
        return true;
      case 'back': case 'up': closeChapters(); showOsd(); return true;
    }
    return true;
  }

  function goToChapter(i) {
    if (!started || !chapters[i]) return;
    seekTarget = Math.min(chapters[i].startTimeOffset, duration - 3000);
    toggleClass(el, 'seeking', true);
    setText(seekLabel, chapterName(chapters[i], i));
    renderProgress(seekTarget);
    showOsd(true);
    clearTimeout(seekTimer);
    seekTimer = setTimeout(commitSeek, SEEK_COMMIT_MS);
  }

  // CH▲/CH▼: next chapter, or back to this chapter's start (the one before
  // when already within its first few seconds).
  function stepChapter(dir) {
    if (!chapters.length) return;
    const at = seekTarget == null ? position : seekTarget;
    let i = chapterAt(at);
    if (dir > 0) i++;
    else if (at - chapters[i].startTimeOffset < 5000) i--;
    goToChapter(Math.max(0, Math.min(chapters.length - 1, i)));
  }

  // --- Skip intro / credits ---------------------------------------------

  function updateSkip(ms) {
    // The final credits bring up the up-next card instead of Skip Credits
    // (unless credits are auto-skipped, or there's nothing next).
    const fc = markers.find(x => x.type === 'credits' && x.endTimeOffset >= duration - 60000);
    const inFinal = !!fc && ms >= fc.startTimeOffset && (item.type === 'episode' || queue.length > 0)
      && credits !== 'auto' && !noNext;
    if (inFinal && upnextState === 'none' && !upnextDismissed) showUpnext(false);
    else if (!inFinal && upnextState === 'credits') hideUpnext();
    let m = markers.find(x => !x.dismissed && ms >= x.startTimeOffset && ms < x.endTimeOffset - 1000) || null;
    if (m === fc && inFinal) m = null;
    if (m === skipFor) return;
    skipFor = m;
    toggleClass(skipBtn, 'hidden', !m);
    if (m) setText(skipBtn, m.type === 'credits' ? 'Skip Credits' : 'Skip Intro');
    if (m && (m.type === 'credits' ? credits === 'auto' : pref('autoSkipIntro'))) skip();
  }

  function skip() {
    const m = skipFor;
    m.dismissed = true;
    updateSkip(position);
    // The final credits: straight to the next episode (or its card, when
    // autoplay is off or the credits were skipped by hand).
    if (m.type === 'credits' && (item.type === 'episode' || queue.length) && m.endTimeOffset >= duration - 60000) {
      if (credits === 'auto' && pref('autoplay') && !isAsleep()) {
        loadNext().then(next => {
          if (!alive) return;
          nextItem = next;
          if (next) playNext(); else finished();
        });
      } else {
        finished();
      }
      return;
    }
    seekTarget = Math.min(m.endTimeOffset, duration - 3000);
    commitSeek();
  }

  // --- Audio / subtitle picker and options ------------------------------
  // Two columns: audio and subtitles, or in search mode language and results.
  // Options (quality, subtitle look and sync) is its own one-column overlay.

  let panelMode = 'tracks';
  let panelCol = 0;
  let panelIndex = [0, 0];
  let panelLists = [[], []];
  let panelHeads = [];
  let searchToken = 0;

  function openPanel(col) {
    const audios = streamsOf(part, 2);
    const texts = streamsOf(part, 3);
    panelMode = 'tracks';
    searchToken++;
    panelHeads = [{ name: 'Audio', icon: icons.audio }, { name: 'Subtitles', icon: icons.subtitles }];
    panelLists = [
      audios.map(s => ({ label: s.displayTitle || s.language || 'Track', stream: s, on: s === audioStream })),
      [{ label: 'Off', stream: null, on: !subStream }]
        .concat(texts.map(s => ({ label: subtitleLabel(s), stream: s, on: s === subStream })))
        .concat([{ label: 'Search subtitles…', search: true }]),
    ];
    panelIndex = panelLists.map(l => Math.max(0, l.findIndex(x => x.on)));
    panelCol = col || 0;
    showPanel();
  }

  function openOptions() {
    panelMode = 'options';
    searchToken++;
    panelHeads = [{ name: 'Options', icon: icons.gear }];
    panelLists = [optionRows()];
    panelIndex = [1];
    panelCol = 0;
    showPanel();
  }

  function showPanel() {
    renderPanel();
    panel.classList.remove('hidden');
    hideOsd();
  }

  // Options: quality, subtitle look and sync. OK changes the value in place
  // (the overlay stays open so the effect is visible).
  // Label on the left, value on the right; ◀ ▶ change it either way and OK
  // steps forward (Sync: ◀ earlier, ▶ later, OK resets). Headings split
  // playback from the subtitle look.
  function optionRows() {
    const look = (key, list) => dir => {
      subStyle[key] = (subStyle[key] + dir + list.length) % list.length;
      store.set('subStyle', subStyle);
      applySubStyle();
    };
    const sub = (label, value, step) => ({ label, value, step, subs: true });
    return [
      { heading: 'Playback' },
      { label: 'Quality', value: streamLimit(quality, session.server.uri).label, pick: pickQuality },
      { label: 'Playback info', value: store.get('playbackInfo', false) ? 'On' : 'Off', step: () => setInfo(!store.get('playbackInfo', false)) },
      { heading: 'Subtitles' },
      sub('Size', SUB_SIZES[subStyle.size][0], look('size', SUB_SIZES)),
      sub('Colour', SUB_COLOURS[subStyle.colour][0], look('colour', SUB_COLOURS)),
      sub('Font', SUB_FONTS[subStyle.font][0], look('font', SUB_FONTS)),
      sub('Weight', SUB_WEIGHTS[subStyle.weight][0], look('weight', SUB_WEIGHTS)),
      sub('Position', SUB_POSITIONS[subStyle.position][0], look('position', SUB_POSITIONS)),
      sub('Style', SUB_BACKS[subStyle.back], look('back', SUB_BACKS)),
      Object.assign(sub('Sync', syncLabel(), dir => setDelay(subDelay + dir * SYNC_STEP)), { reset: () => setDelay(0) }),
    ];
  }

  // A sample line while a subtitle-look row is focused and nothing's showing,
  // so changes can be seen.
  const SAMPLE = 'Subtitles will look like this';
  function previewSubs(on) {
    if (on && !subsText.textContent) setText(subsText, SAMPLE);
    else if (!on && subsText.textContent === SAMPLE) setText(subsText, '');
  }

  // --- Playback info: what's actually playing (direct or converted, codecs,
  // resolution, bitrate), with the server's decisions while it converts.

  function setInfo(on) {
    store.set('playbackInfo', on);
    toggleClass(infoEl, 'hidden', !on);
    clearInterval(infoTimer);
    if (on) { renderInfo(); infoTimer = setInterval(renderInfo, 3000); }
  }

  const kbps = n => (n >= 1000 ? (n / 1000).toFixed(1) + ' Mbps' : n + ' kbps');

  async function renderInfo() {
    if (!media || !part) return;
    const v = streamsOf(part, 1)[0] || {};
    const lines = [];
    const add = (k, val) => { if (val) lines.push([k, val]); };
    add('Playback', mode === 'direct' ? 'Direct play' : 'Converted by Plex');
    add('File', [media.container && media.container.toUpperCase(), media.bitrate && kbps(media.bitrate)].filter(Boolean).join('  ·  '));
    add('Video', [String(v.codec || media.videoCodec || '').toUpperCase(), v.width && v.height ? v.width + '×' + v.height : '',
      v.frameRate ? Math.round(v.frameRate * 100) / 100 + ' fps' : '', v.DOVIPresent ? 'Dolby Vision' : /pq|hlg|smpte2084/i.test(v.colorTrc || '') ? 'HDR' : ''].filter(Boolean).join('  ·  '));
    const audio = mode === 'direct' ? playedAudio() : audioStream;
    add('Audio', audio ? [audio.displayTitle || audio.codec, audio.language].filter(Boolean).join('  ·  ') +
      (audio !== audioStream ? '  (TV can\'t play ' + String(audioStream.codec).toUpperCase() + ')' : '') : 'None');
    add('Subtitles', subStream ? subtitleLabel(subStream) : 'Off');
    add('Quality', streamLimit(quality, session.server.uri).label);
    add('Server', { local: 'Your network', remote: 'Remote', relay: 'Plex relay' }[connectionKind(session.server.uri)]);
    if (mode === 'hls') {
      try {
        const mc = await session.server.get('/transcode/sessions');
        const t = (mc.TranscodeSession || []).find(s => s.key && s.key.indexOf(playSession) !== -1);
        if (t) {
          add('Video stream', (t.videoDecision === 'copy' ? 'Copied' : 'Converted') + (t.videoCodec ? ' to ' + t.videoCodec.toUpperCase() : '') + (t.width ? '  ·  ' + t.width + '×' + t.height : ''));
          add('Audio stream', (t.audioDecision === 'copy' ? 'Copied' : 'Converted') + (t.audioCodec ? ' to ' + t.audioCodec.toUpperCase() : '') + (t.audioChannels ? '  ·  ' + t.audioChannels + ' ch' : ''));
          add('Server speed', t.speed ? Number(t.speed).toFixed(1) + '× real time' + (t.throttled ? ' (ahead, resting)' : '') : '');
        }
      } catch (e) { /* the rest still shows */ }
    }
    if (infoEl.classList.contains('hidden')) return;
    infoEl.innerHTML = '';
    h('div', 'pi-title', infoEl).textContent = 'Playback info';
    lines.forEach(([k, val]) => {
      const row = h('div', 'pi-row', infoEl);
      h('span', 'pi-k', row).textContent = k;
      h('span', 'pi-v', row).textContent = val;
    });
  }

  // Another quality for this video, from a list; reopens at the current
  // position once one is picked.
  function pickQuality() {
    const auto = streamLimit('auto', session.server.uri).label;
    showMenu({
      title: 'Quality',
      items: QUALITIES.map(q => ({
        label: q.id === 'auto' ? auto : q.label,
        on: q.id === quality,
        run: () => {
          if (q.id === quality) return;
          quality = q.id;
          panelLists[0] = optionRows();
          renderPanel();
          if (!alive || !started) return;
          mode = decideMode();
          triedFallback = false;
          open(position).catch(e => failed(e.message));
        },
      })),
    });
  }

  function closePanel() {
    searchToken++;
    panel.classList.add('hidden');
    previewSubs(false);
  }

  // The TV's language and English first, then the file's languages, then the rest.
  function searchLanguages() {
    const names = Object.assign({}, LANGUAGES);
    const codes = [(navigator.language || '').slice(0, 2), 'en'];
    streamsOf(part, 2).concat(streamsOf(part, 3)).forEach(s => {
      const c = (s.languageTag || '').slice(0, 2);
      if (!c) return;
      codes.push(c);
      if (!names[c] && s.language) names[c] = s.language;
    });
    codes.push.apply(codes, Object.keys(LANGUAGES));
    return codes.filter((c, i) => c && names[c] && codes.indexOf(c) === i).map(c => ({ code: c, name: names[c] }));
  }

  function openSearch() {
    panelMode = 'search';
    panelHeads = [{ name: 'Language', icon: icons.subtitles }, { name: 'Download', icon: icons.search }];
    panelLists = [searchLanguages().map(l => ({ label: l.name, lang: l.code })), [{ label: 'Choose a language', status: true }]];
    panelIndex = [0, 0];
    panelCol = 0;
    renderPanel();
  }

  async function runSearch(opt) {
    const token = ++searchToken;
    panelLists[0].forEach(o => { o.on = o === opt; });
    panelLists[1] = [{ label: 'Searching…', status: true }];
    panelIndex[1] = 0;
    renderPanel();
    let results = null;
    try {
      results = await session.server.searchSubtitles(item.ratingKey, opt.lang);
    } catch (e) {
      warn('subtitle search failed', e.message);
    }
    if (token !== searchToken) return;
    panelLists[1] = !results ? [{ label: 'Search failed', status: true }]
      : !results.length ? [{ label: 'Nothing found', status: true }]
      : results.map(r => ({ label: (r.hearingImpaired ? '[SDH]  ' : '') + (r.title || r.displayTitle), result: r }));
    if (results && results.length) panelCol = 1;
    renderPanel();
  }

  // The server downloads the file and adds it to the part as an external
  // stream; reload the metadata until it shows up, then select it.
  async function download(opt) {
    const token = ++searchToken;
    const server = session.server;
    const before = streamsOf(part, 3).map(s => s.id);
    setText(panel.querySelector('.tracks-opt.focus'), 'Downloading…');
    try {
      await server.downloadSubtitle(item.ratingKey, opt.result);
      let added = null;
      for (let i = 0; i < 6 && !added; i++) {
        if (i) await new Promise(r => setTimeout(r, 1000));
        const full = await server.metadata(item.ratingKey, { markers: true });
        const fresh = [].concat.apply([], (full.Media || []).map(m => m.Part || [])).find(p => p.id === part.id);
        added = fresh && streamsOf(fresh, 3).find(s => before.indexOf(s.id) === -1);
        if (added) adoptPart(full, fresh);
      }
      if (token !== searchToken || !alive) return;
      if (!added) throw new Error('the new subtitle never appeared');
      log('subtitle downloaded', added.displayTitle, added.title || '');
      choose(1, { stream: added });
    } catch (e) {
      warn('subtitle download failed', e.message);
      if (token !== searchToken) return;
      panelLists[1] = [{ label: 'Download failed', status: true }];
      panelIndex[1] = 0;
      renderPanel();
    }
  }

  // Swap in reloaded metadata, keeping the current stream choices.
  function adoptPart(full, fresh) {
    const same = (list, s) => (s && list.find(x => x.id === s.id)) || s;
    item = full;
    media = (full.Media || []).find(m => (m.Part || []).indexOf(fresh) !== -1) || media;
    part = fresh;
    audioStream = same(streamsOf(part, 2), audioStream);
    subStream = same(streamsOf(part, 3), subStream);
  }

  function renderPanel() {
    panel.innerHTML = '';
    toggleClass(panel, 'searching', panelMode === 'search');
    toggleClass(panel, 'options', panelMode === 'options');
    panelHeads.forEach((head, c) => {
      const col = h('div', 'tracks-col', panel);
      const headEl = h('div', 'tracks-head', col);
      headEl.innerHTML = head.icon;
      h('span', '', headEl).textContent = head.name;
      // Long lists scroll: show a window of rows around the focused one.
      const list = panelLists[c];
      const first = Math.max(0, Math.min(panelIndex[c] - (PANEL_ROWS >> 1), list.length - PANEL_ROWS));
      list.slice(first, first + PANEL_ROWS).forEach((opt, j) => {
        const i = first + j;
        if (opt.heading) { h('div', 'tracks-group', col).textContent = opt.heading; return; }
        const row = h('div', 'tracks-opt', col);
        if (opt.step || opt.pick) {
          h('span', 'opt-label', row).textContent = opt.label;
          h('span', 'opt-value', row).textContent = opt.value;
        } else {
          row.textContent = opt.label;
        }
        toggleClass(row, 'on', !!opt.on);
        toggleClass(row, 'status', !!opt.status);
        toggleClass(row, 'focus', c === panelCol && i === panelIndex[c]);
      });
    });
    const focused = panelLists[panelCol][panelIndex[panelCol]] || {};
    h('div', 'tracks-hint', panel).textContent = panelMode === 'options'
      ? (focused.reset ? '◀ Earlier   ▶ Later   OK Reset' : focused.pick ? 'OK Choose' : '◀ ▶ Change   OK Next') + '   Back Close'
      : panelMode === 'search' ? '◀ ▶ Column   OK Choose   Back Return'
        : '◀ ▶ Audio / Subtitles   OK Choose   Back Close';
    if (panelMode === 'options') previewSubs(!!focused.subs);
  }

  async function choose(col, opt) {
    const server = session.server;
    if (col === 0) audioStream = opt.stream;
    else subStream = opt.stream;
    server.selectStreams(part.id, {
      audioStreamID: audioStream ? audioStream.id : undefined,
      subtitleStreamID: subStream ? subStream.id : 0,
    });
    closePanel();
    const wanted = decideMode();
    if (wanted === 'direct' && mode === 'direct' && applyTracks()) {
      syncSidecar();
    } else if (mode === 'hls' && wanted === 'hls' && col === 1 && isSidecarText(subStream) && !burned) {
      syncSidecar();
    } else {
      // A subtitle the TV doesn't list (see applyTracks): Plex burns it in.
      mode = wanted === 'direct' && mode === 'direct' ? 'hls' : wanted;
      triedFallback = false;
      await open(position).catch(e => failed(e.message));
    }
  }

  function panelKey(action) {
    if (action === 'back') {
      if (panelMode === 'search') openPanel();
      else closePanel();
      return true;
    }
    if (panelMode === 'options') return optionsKey(action);
    if (action === 'up' && panelIndex[panelCol] === 0) return true;
    if (action === 'left' || action === 'right') {
      panelCol = Math.max(0, Math.min(panelLists.length - 1, panelCol + (action === 'left' ? -1 : 1)));
    }
    if (action === 'up') panelIndex[panelCol]--;
    if (action === 'down') panelIndex[panelCol] = Math.min(panelLists[panelCol].length - 1, panelIndex[panelCol] + 1);
    if (action === 'enter') {
      const opt = panelLists[panelCol][panelIndex[panelCol]];
      if (!opt || opt.status) return true;
      if (opt.search) openSearch();
      else if (opt.lang) runSearch(opt);
      else if (opt.result) download(opt);
      else choose(panelCol, opt);
      return true;
    }
    renderPanel();
    return true;
  }

  function optionsKey(action) {
    const list = panelLists[0];
    const opt = list[panelIndex[0]];
    if (action === 'up' || action === 'down') {
      // Skip headings; stop at the ends.
      let i = panelIndex[0] + (action === 'up' ? -1 : 1);
      while (list[i] && list[i].heading) i += action === 'up' ? -1 : 1;
      if (list[i]) panelIndex[0] = i;
    } else if (opt.pick && (action === 'left' || action === 'right' || action === 'enter')) {
      opt.pick();
    } else if (action === 'left' || action === 'right') {
      opt.step(action === 'left' ? -1 : 1);
    } else if (action === 'enter') {
      if (opt.reset) opt.reset(); else opt.step(1);
    } else {
      return true;
    }
    panelLists[0] = optionRows();
    renderPanel();
    return true;
  }

  // --- Ending -----------------------------------------------------------

  async function nextEpisode() {
    const server = session.server;
    const eps = await server.children(item.parentRatingKey);
    const i = eps.findIndex(e => e.ratingKey === item.ratingKey);
    if (i >= 0 && i < eps.length - 1) return eps[i + 1];
    const seasons = (await server.children(item.grandparentRatingKey)).filter(s => s.type === 'season');
    const si = seasons.findIndex(s => s.ratingKey === item.parentRatingKey);
    if (si >= 0 && si < seasons.length - 1) return (await server.children(seasons[si + 1].ratingKey))[0] || null;
    return null;
  }

  // Up next: a card with the next episode (or shuffle pick). It comes up when
  // the final credits start ('credits': the video keeps playing, Back hides
  // it) and when the video ends ('end': Back stops). Autoplay counts down
  // from the setting; when it's off the card just offers the next one.
  let upnextState = 'none';
  let upnextDismissed = false;
  let noNext = false;
  let nextLoad = null;

  function loadNext() {
    if (!nextLoad) {
      nextLoad = queue.length ? Promise.resolve(queue[0])
        : item.type === 'episode' ? nextEpisode().catch(() => null) : Promise.resolve(null);
    }
    return nextLoad;
  }

  async function showUpnext(ending) {
    upnextState = ending ? 'end' : 'credits';
    nextItem = await loadNext();
    if (!alive || upnextState === 'none') return;
    if (!nextItem) {
      noNext = true;
      upnextState = 'none';
      if (ending) exit(); else updateSkip(position);
      return;
    }
    clearInterval(upnextTimer);
    // Passout protection: after hours of autoplay with no key press, ask
    // instead of playing on.
    const asleep = isAsleep();
    const seconds = asleep ? 0 : pref('autoplay');
    let left = seconds;
    const ep = nextItem.type === 'episode';
    upnext.innerHTML = '';
    const img = h('img', 'upnext-img', upnext);
    img.alt = '';
    const art = ep ? nextItem.thumb : nextItem.art || nextItem.thumb;
    if (art) img.src = session.server.image(art, 384, 216);
    const text = h('div', 'upnext-text', upnext);
    const label = h('div', 'upnext-label', text);
    h('div', 'upnext-title', text).textContent = ep ? nextItem.grandparentTitle || nextItem.title : nextItem.title;
    h('div', 'upnext-sub', text).textContent = ep ? episodeLabel(nextItem) + '  ' + nextItem.title : String(nextItem.year || '');
    h('div', 'upnext-hint', text).textContent = asleep ? 'Still watching? OK to keep going · Back to stop'
      : 'OK to play now · Back to ' + (ending ? 'stop' : 'keep watching');
    const fill = h('i', '', h('div', 'upnext-bar', upnext));
    const render = () => {
      setText(label, asleep ? 'Still watching?' : seconds ? 'Up next in ' + left : 'Up next');
      setTransform(fill, 'scaleX(' + (seconds ? (seconds - left) / seconds : 0).toFixed(3) + ')');
    };
    render();
    toggleClass(upnext, 'hidden', false);
    if (!seconds) return;
    upnextTimer = setInterval(() => {
      left--;
      render();
      if (left <= 0) playNext();
    }, 1000);
  }

  function isAsleep() {
    const hours = pref('stillWatching');
    return !!hours && Date.now() - lastKeyAt() > hours * 3600000;
  }

  function hideUpnext() {
    clearInterval(upnextTimer);
    upnextState = 'none';
    toggleClass(upnext, 'hidden', true);
  }

  async function finished() {
    position = duration;
    report('stopped');
    clearInterval(timelineTimer);
    clearInterval(cueTimer);
    clearTimeout(subTimer);
    setText(subsText, '');
    player.close();
    hideUpnext();
    if (!queue.length && item.type !== 'episode') { exit(); return; }
    showUpnext(true);
  }

  function playNext() {
    clearInterval(upnextTimer);
    router.replace(PlayerScreen(nextItem, { offset: 0, queue: queue.slice(1) }));
  }

  function exit() {
    router.back();
  }

  function teardown() {
    if (!alive) return;
    alive = false;
    if (started && position < duration) report('stopped');
    [seekTimer, osdTimer, subTimer, thumbTimer].forEach(clearTimeout);
    clearInterval(infoTimer);
    clearInterval(timelineTimer);
    clearInterval(upnextTimer);
    clearInterval(cueTimer);
    player.destroy();
    if (burned !== undefined) session.server.stopTranscode(playSession);
    document.documentElement.classList.remove('playing');
    setScreenSaver(true);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function onVisibility() {
    if (document.hidden) {
      if (started && !paused) togglePause();
      player.suspend();
    } else {
      player.restore();
    }
  }

  return {
    el,
    name: 'player',
    onShow() {
      stopTheme(true);
      document.documentElement.classList.add('playing');
      setScreenSaver(false);
      document.addEventListener('visibilitychange', onVisibility);
      renderTitles();
      if (!started) start();
    },
    onKey(action) {
      if (upnextState === 'end') {
        if (action === 'enter' && nextItem) { playNext(); return true; }
        if (action === 'back' || action === 'stop') { exit(); return true; }
        return true;
      }
      // During the credits the card takes OK and Back; everything else still
      // works on the video.
      if (upnextState === 'credits' && !upnext.classList.contains('hidden') && panel.classList.contains('hidden')
          && chapterStrip.classList.contains('hidden') && ctlIndex < 0 && seekTarget == null) {
        if (action === 'enter') { playNext(); return true; }
        if (action === 'back') { upnextDismissed = true; hideUpnext(); return true; }
      }
      if (!panel.classList.contains('hidden')) return panelKey(action);
      if (!chapterStrip.classList.contains('hidden')) return chapterKey(action);
      if (ctlIndex >= 0 && el.classList.contains('osd-on')) {
        if (action === 'left' || action === 'right') {
          const dir = action === 'left' ? -1 : 1;
          let next = ctlIndex + dir;
          while (CONTROLS[next] && CONTROLS[next].hidden) next += dir;
          if (CONTROLS[next]) ctlIndex = next;
          showOsd(paused);
          return true;
        }
        if (action === 'enter') { CONTROLS[ctlIndex].run(); return true; }
        if (action === 'back' || action === 'up') {
          ctlIndex = -1;
          showOsd(paused);
          return true;
        }
        if (action === 'down') return true;
      }
      if (skipFor && seekTarget == null) {
        if (action === 'enter') { skip(); return true; }
        if (action === 'back' && !el.classList.contains('osd-on')) {
          skipFor.dismissed = true;
          updateSkip(position);
          return true;
        }
      }
      switch (action) {
        case 'enter':
          if (seekTarget != null) commitSeek();
          else if (el.classList.contains('osd-on') || paused) togglePause();
          else showOsd();
          return true;
        case 'playpause': if (seekTarget != null) commitSeek(); else togglePause(); return true;
        case 'play': if (paused) togglePause(); return true;
        case 'pause': if (!paused) togglePause(); return true;
        case 'left': case 'rw': seekBy(-1); return true;
        case 'right': case 'ff': seekBy(1); return true;
        case 'up': case 'info': showOsd(); return true;
        case 'down':
          // ▼ goes to the control row (showing the OSD first if needed).
          if (seekTarget == null) ctlIndex = PLAY_CTL;
          showOsd(paused);
          return true;
        case 'pageup': stepChapter(1); return true;
        case 'pagedown': stepChapter(-1); return true;
        case 'stop': exit(); return true;
        case 'back':
          if (seekTarget != null) { seekTarget = null; toggleClass(el, 'seeking', false); renderProgress(position); showOsd(); return true; }
          if (el.classList.contains('osd-on') && !paused) { hideOsd(); return true; }
          exit();
          return true;
      }
      return true;
    },
    onHide() {},
    destroy: teardown,
  };
}
