// Text subtitles we draw ourselves: sidecar (external) files over a
// direct-played video, so an .srt next to the file never forces the server to
// transcode, and embedded tracks streamed as text beside a transcode.

function ms(h, m, s, frac) {
  return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round(+('0.' + (frac || '0')) * 1000);
}

function clean(text) {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/gi, '\n')
    .trim();
}

// --- Placement ------------------------------------------------------------
// A cue may carry place: { x, y } on the picture (0…1 each way) and which part
// of the text sits there: h -1 left edge, 0 middle, 1 right edge; v -1 top,
// 0 middle, 1 bottom. No place: Settings' position. colour: the file's own
// (an ASS style or \c), as #RRGGBB; none: Settings' colour.

// ASS's numpad alignment (1 bottom left … 9 top right) at the screen's margins.
function numpad(an, margin = 0.05) {
  const h = [-1, 0, 1][(an - 1) % 3];
  const v = [1, 0, -1][Math.floor((an - 1) / 3)];
  return { x: h === -1 ? margin : h === 1 ? 1 - margin : 0.5, y: v === -1 ? margin : v === 1 ? 1 - margin : 0.5, h, v };
}

// SSA v4 numbers alignment differently (1–3 bottom, +4 top, +8 middle).
const SSA_ALIGN = { 1: 1, 2: 2, 3: 3, 5: 7, 6: 8, 7: 9, 9: 4, 10: 5, 11: 6 };

// &HAABBGGRR (or &HBBGGRR) → #RRGGBB; white gives null (Settings' colour).
export function assColour(s) {
  const str = String(s).trim();
  // SSA v4 writes a decimal number; ASS writes &H hex.
  const v = /^-?\d+$/.test(str) ? parseInt(str, 10) : parseInt(str.toUpperCase().replace(/&H|&/g, ''), 16);
  if (isNaN(v)) return null;
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff;
  if (r > 0xf0 && g > 0xf0 && b > 0xf0) return null;
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// The override tags in a line (ASS, or an SRT's {\an8}): \an, \a, \pos, \c / \1c.
export function assTags(raw, res = [1920, 1080]) {
  const blocks = (String(raw).match(/\{[^}]*\}/g) || []).join('');
  // exact: the place is a \pos (no stacking with others at the same spot).
  const out = { align: null, place: null, colour: null, exact: false };
  let m = /\\an([1-9])/.exec(blocks);
  if (m) out.align = +m[1];
  else if ((m = /\\a(\d+)/.exec(blocks)) && SSA_ALIGN[+m[1]]) out.align = SSA_ALIGN[+m[1]];
  if ((m = /\\pos\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(blocks))) {
    const an = out.align || 2;
    out.place = { x: +m[1] / res[0], y: +m[2] / res[1], h: [-1, 0, 1][(an - 1) % 3], v: [1, 0, -1][Math.floor((an - 1) / 3)] };
    out.exact = true;
  } else if (out.align && out.align !== 2) {
    out.place = numpad(out.align);
  }
  if ((m = /\\1?c&?H?([0-9A-Fa-f]{6})&?/.exec(blocks))) out.colour = assColour(m[1]);
  return out;
}

// WebVTT cue settings: line:N% / line:N, position:N%, align:start|center|end.
function vttPlace(settings) {
  const value = k => { const m = new RegExp('(?:^|\\s)' + k + ':([^\\s,]+)').exec(settings); return m ? m[1] : null; };
  const line = value('line'), pos = value('position'), align = value('align');
  if (line == null && pos == null && (!align || align === 'center' || align === 'middle')) return null;
  const h = align === 'start' || align === 'left' ? -1 : align === 'end' || align === 'right' ? 1 : 0;
  const x = pos != null ? parseFloat(pos) / 100 : h === -1 ? 0.05 : h === 1 ? 0.95 : 0.5;
  let y = 0.92, v = 1;
  if (line != null) {
    if (/%$/.test(line)) { y = parseFloat(line) / 100; v = y < 0.5 ? -1 : 1; }
    else { const n = parseInt(line, 10); y = n >= 0 ? 0.05 + n * 0.06 : 0.95 + (n + 1) * 0.06; v = n >= 0 ? -1 : 1; }
  }
  // Only a sideways place, at the bottom: still the bottom, where Settings puts lines.
  if (line == null && h === 0 && Math.abs(x - 0.5) < 0.01) return null;
  return { x, y, h, v };
}

function srtCue(start, end, raw, settings) {
  const tags = assTags(raw);
  const cue = { start, end, text: clean(raw) };
  const place = tags.place || vttPlace(settings || '');
  if (place) cue.place = place;
  if (tags.place && !tags.exact) cue.stacks = true;
  if (tags.colour) cue.colour = tags.colour;
  return cue;
}

function parseSrtOrVtt(text) {
  const cues = [];
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})([^\n]*)\n([\s\S]*?)(?:\n\s*\n|$)/g;
  let m;
  while ((m = re.exec(text))) {
    cues.push(srtCue(ms(m[1], m[2], m[3], m[4]), ms(m[5], m[6], m[7], m[8]), m[10], m[9]));
  }
  // WebVTT allows mm:ss.ttt without hours.
  if (!cues.length) {
    const short = /(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})([^\n]*)\n([\s\S]*?)(?:\n\s*\n|$)/g;
    while ((m = short.exec(text))) {
      cues.push(srtCue(ms(0, m[1], m[2], m[3]), ms(0, m[4], m[5], m[6]), m[8], m[7]));
    }
  }
  return cues;
}

// Reads ASS line by line, a whole file or the server's stream while it
// converts: PlayRes and styles (where each style's lines go, their colour),
// then Dialogue lines as cues.
export class AssReader {
  constructor() {
    this.res = [0, 0];
    this.styles = {};
    this.styleFields = [];
    this.eventFields = [];
    this.section = '';
  }

  // A cue for a Dialogue line, or null.
  line(raw) {
    const l = String(raw).trim();
    if (l[0] === '[') { this.section = l.toLowerCase(); return null; }
    let m;
    if ((m = /^PlayResX:\s*([\d.]+)/i.exec(l))) { this.res[0] = +m[1]; return null; }
    if ((m = /^PlayResY:\s*([\d.]+)/i.exec(l))) { this.res[1] = +m[1]; return null; }
    if (/^Format:/i.test(l)) {
      const f = l.slice(7).split(',').map(x => x.trim().toLowerCase());
      if (this.section.indexOf('styles') >= 0) this.styleFields = f; else this.eventFields = f;
      return null;
    }
    if (/^Style:/i.test(l) && this.styleFields.length) {
      const v = l.slice(6).split(',').map(x => x.trim());
      const f = k => { const i = this.styleFields.indexOf(k); return i >= 0 ? v[i] : undefined; };
      const a = parseInt(f('alignment'), 10);
      this.styles[f('name') || ''] = {
        align: isNaN(a) ? 2 : this.section.indexOf('v4+') >= 0 ? a : SSA_ALIGN[a] || 2,
        marginL: +f('marginl') || 10, marginR: +f('marginr') || 10, marginV: +f('marginv') || 10,
        colour: f('primarycolour') ? assColour(f('primarycolour')) : null,
      };
      return null;
    }
    if (!/^Dialogue:/i.test(l)) return null;
    const fields = this.eventFields.length ? this.eventFields : ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const ti = Math.max(0, fields.indexOf('text'));
    const parts = l.slice(9).split(',');
    const f = k => { const i = fields.indexOf(k); return i >= 0 ? parts[i] : undefined; };
    const t = s => (s || '').trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{1,3})/);
    const a = t(f('start') || parts[1]);
    const b = t(f('end') || parts[2]);
    if (!a || !b) return null;
    const rawText = parts.slice(ti).join(',');
    const text = clean(rawText);
    if (!text) return null;
    // Only one size given: the other follows 16:9 (libass does 4:3; 16:9 suits video now).
    let [rx, ry] = this.res;
    if (!rx && !ry) { rx = 1920; ry = 1080; } else if (!rx) rx = ry * 16 / 9; else if (!ry) ry = rx * 9 / 16;
    const st = this.styles[(f('style') || '').trim()] || this.styles.Default || { align: 2, marginL: 10, marginR: 10, marginV: 10, colour: null };
    const tags = assTags(rawText, [rx, ry]);
    const cue = { start: ms(a[1], a[2], a[3], a[4]), end: ms(b[1], b[2], b[3], b[4]), text };
    // Placed by alignment rather than an exact \pos: lines sharing that spot
    // stack instead of overlapping (ASS collisions, as libass does).
    if (tags.place) { cue.place = tags.place; if (!tags.exact) cue.stacks = true; }
    else {
      cue.stacks = true;
      const an = tags.align || st.align;
      // The bottom middle is where Settings puts lines; anywhere else is the file's.
      if (an !== 2) {
        const p = numpad(an);
        const mv = (+(f('marginv') || 0) || st.marginV) / ry;
        if (p.h === -1) p.x = st.marginL / rx; else if (p.h === 1) p.x = 1 - st.marginR / rx;
        if (p.v === -1) p.y = mv; else if (p.v === 1) p.y = 1 - mv;
        cue.place = p;
      }
    }
    const colour = tags.colour || st.colour;
    if (colour) cue.colour = colour;
    return cue;
  }
}

function parseAss(text) {
  const reader = new AssReader();
  const cues = [];
  text.split(/\r?\n/).forEach(line => { const cue = reader.line(line); if (cue) cues.push(cue); });
  return cues.sort((x, y) => x.start - y.start);
}

// One ASS "Dialogue:" line as a cue, or null (no styles known).
export function assDialogue(line) {
  return new AssReader().line(line);
}

export function parseSubtitles(text, codec) {
  text = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  if (codec === 'ass' || codec === 'ssa' || /^\[Script Info\]/m.test(text)) return parseAss(text);
  return parseSrtOrVtt(text);
}

// Finds the active cue for a playback position; cheap for monotonic playback,
// binary search after jumps.
export class CueTrack {
  constructor(cues) {
    this.cues = cues;
    this.i = 0;
  }

  // Cues arriving while playing (a transcode's subtitle stream): kept in
  // order, and the server's repeats across its chunks dropped.
  add(cue) {
    const cues = this.cues;
    let i = cues.length;
    while (i > 0 && cues[i - 1].start > cue.start) i--;
    for (let j = i - 1; j >= 0 && cues[j].start === cue.start; j--) if (cues[j].text === cue.text) return;
    cues.splice(i, 0, cue);
    if (i <= this.i && this.i < cues.length - 1) this.i++;
  }

  // Every cue showing at t (overlapping ones too), oldest first.
  showing(t) {
    const cues = this.cues;
    if (!cues.length) return [];
    this.at(t);
    const out = [];
    for (let j = this.i; j >= 0 && j >= this.i - 12; j--) {
      if (cues[j].start <= t && t < cues[j].end) out.unshift(cues[j]);
    }
    return out;
  }

  at(t) {
    const cues = this.cues;
    if (!cues.length) return '';
    let i = this.i;
    if (i >= cues.length || cues[i].start > t || (i + 1 < cues.length && cues[i + 1].start <= t && t - cues[i].start > 30000)) {
      let lo = 0;
      let hi = cues.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cues[mid].start <= t) lo = mid; else hi = mid - 1;
      }
      i = lo;
    }
    while (i + 1 < cues.length && cues[i + 1].start <= t) i++;
    this.i = i;
    const c = cues[i];
    if (c.start <= t && t < c.end) {
      // Overlapping cues (common in ASS) are shown together.
      let text = c.text;
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (cues[j].end > t && cues[j].text !== text) text = cues[j].text + '\n' + text;
      }
      return text;
    }
    return '';
  }
}
