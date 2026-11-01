// Run on the TV (dev build) by tools/scan-tracks.sh: lists files whose track
// count (video + audio + embedded subtitles) is over a limit, the "stream
// count exceeds 30" Samsung case. ARGS = { min, sections } is prepended.
(async function () {
  var s;
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (/server$/.test(k)) s = JSON.parse(localStorage.getItem(k));
  }
  var get = p => fetch(s.uri + p + (p.indexOf('?') < 0 ? '?' : '&') + 'X-Plex-Token=' + s.token,
    { headers: { Accept: 'application/json' } }).then(r => r.json()).then(d => d.MediaContainer);
  var dirs = (await get('/library/sections')).Directory.filter(d => d.type === 'movie' || d.type === 'show');
  if (ARGS.sections) dirs = dirs.filter(d => ARGS.sections.indexOf(String(d.key)) >= 0);
  var items = [];
  for (var d of dirs) {
    var all = await get('/library/sections/' + d.key + '/all?type=' + (d.type === 'movie' ? 1 : 4));
    items = items.concat((all.Metadata || []).map(m => ({ key: m.ratingKey, name: m.grandparentTitle ? m.grandparentTitle + ' ' + 'S' + m.parentIndex + 'E' + m.index : m.title + (m.year ? ' (' + m.year + ')' : '') })));
  }
  var hits = [], done = 0, next = 0;
  async function worker() {
    while (next < items.length) {
      var it = items[next++];
      try {
        var m = (await get('/library/metadata/' + it.key)).Metadata[0];
        (m.Media || []).forEach(md => (md.Part || []).forEach(p => {
          var st = (p.Stream || []).filter(x => !x.key);
          if (st.length > ARGS.min) {
            var n = t => st.filter(x => x.streamType === t).length;
            hits.push(st.length + ' tracks (' + n(2) + ' audio, ' + n(3) + ' subs) ' + it.name + ' [' + md.videoResolution + ' ' + md.videoCodec + ']');
          }
        }));
      } catch (e) { hits.push('ERR ' + it.name + ' ' + e.message); }
      done++;
    }
  }
  await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
  hits.sort((a, b) => parseInt(b) - parseInt(a));
  return 'scanned ' + done + ' files, ' + hits.length + ' over ' + ARGS.min + ' tracks: || ' + hits.join(' || ');
})()
