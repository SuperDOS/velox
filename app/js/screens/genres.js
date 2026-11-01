// A library's genres as tiles, each with artwork from one of its titles.
// OK opens the library filtered to that genre.
import { h, setText } from '../util/dom.js';
import { useAmbience } from '../ui/backdrop.js';
import { Grid } from '../ui/grid.js';
import { session } from '../session.js';
import { error } from '../util/log.js';

export function GenresScreen(section, { onPick }) {
  const el = h('div', 'screen library genres');
  const ambience = useAmbience();
  const head = h('header', 'lib-head', el);
  h('h1', 'lib-title', head).textContent = section.title + ' · Genres';
  const count = h('div', 'lib-count', head);
  const type = section.type === 'show' ? 2 : 1;
  let genres = [];
  let alive = true;

  const grid = new Grid({
    cols: 4, kind: 'wide', top: 200, height: 880,
    getItem: i => genres[i],
    onSelect: g => onPick({ key: 'genre', value: g.key, label: g.title }),
  });
  el.appendChild(grid.el);

  async function load() {
    const server = session.server;
    try {
      const mc = await server.get('/library/sections/' + section.key + '/genre', { type });
      if (!alive) return;
      genres = (mc.Directory || []).map(d => ({ type: 'genre', key: d.key, title: d.title, sub: '' }));
      setText(count, genres.length + ' genres');
      grid.setTotal(genres.length);
      // A random title's backdrop for each genre, filled in as they arrive:
      // a few requests at a time, cached for a while, redrawn in batches.
      let next = 0;
      let redraw = 0;
      const fill = async () => {
        while (alive && next < genres.length) {
          const i = next++;
          const g = genres[i];
          try {
            const r = await server.get('/library/sections/' + section.key + '/all', { type, genre: g.key, sort: 'random', 'X-Plex-Container-Size': 1, excludeFields: 'summary' }, { maxAge: 300000 });
            const m = (r.Metadata || [])[0];
            if (!alive || !m) continue;
            // A new object: the grid only redraws tiles whose item changed.
            genres[i] = Object.assign({}, g, { art: m.art || m.thumb });
            if (!redraw) redraw = setTimeout(() => { redraw = 0; if (alive) grid.refresh(); }, 100);
          } catch (e) { /* no artwork for this one */ }
        }
      };
      for (let w = 0; w < 4; w++) fill();
    } catch (e) {
      error('genres failed', e);
      setText(count, 'Couldn\'t load genres.');
    }
  }
  load();

  return {
    el,
    name: 'genres',
    onShow() { ambience.restore(); },
    onKey(action) {
      switch (action) {
        case 'left': grid.move(-1, 0); return true;
        case 'right': grid.move(1, 0); return true;
        case 'up': grid.move(0, -1); return true;
        case 'down': grid.move(0, 1); return true;
        case 'enter': grid.select(); return true;
      }
      return false;
    },
    destroy() { alive = false; },
  };
}
