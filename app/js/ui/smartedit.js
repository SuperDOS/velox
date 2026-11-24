// Making and editing a smart collection with the remote: rules like Plex
// Web's advanced filters (field, condition, value), "all" or "any" of them,
// groups of rules, a sort and a limit, with a live count of what matches.
// Built from menus: each change reopens the editor where it was.
import { showMenu, showPrompt, relabel } from './menu.js';
import * as icons from './icons.js';
import { session } from '../session.js';
import { request } from '../plex/client.js';
import { parseFilter, contentUri, matchCount, fieldsFor, valuesFor, DATE_PRESETS } from '../plex/smart.js';
import { error } from '../util/log.js';
import { renameShelf } from '../util/shelves.js';

const LIMITS = [0, 5, 10, 20, 25, 50, 100, 200, 500];
const BIG_LIST = 150; // longer value lists (actors) ask for a few letters first

// collection: a smart collection to edit, or null for a new one in section
// ({ key, title, type }). onDone() after saving.
export async function editSmartCollection({ collection = null, section = null, onDone = () => {} }) {
  const server = session.server;
  let sectionKey;
  let root;
  let title;
  if (collection) {
    const full = collection.content ? collection : await server.metadata(collection.ratingKey).catch(() => null);
    if (!full) return;
    sectionKey = String(full.librarySectionID || collection.librarySectionID);
    root = parseFilter(full.content || '');
    title = full.title;
  } else {
    sectionKey = String(section.key);
    root = { match: 'all', rules: [], sort: 'addedAt:desc', limit: 0, type: section.type === 'show' ? 2 : 1 };
    title = '';
  }
  let meta;
  try {
    meta = await fieldsFor(sectionKey, root.type);
  } catch (e) {
    error('smart collection fields failed', e);
    return;
  }
  const noun = root.type === 2 ? 'shows' : 'movies';
  const fieldOf = key => meta.fields.find(f => f.key === key) || { key, title: key, type: 'string' };
  const opsOf = f => meta.ops[f.type] || [{ key: '=', title: 'is' }];
  let dirty = false;

  // Value titles for rules that store an id (genre 4 = Action).
  const titles = new Map();
  const loadTitles = rules => Promise.all(rules.map(r => {
    if (r.rules) return loadTitles(r.rules);
    const f = fieldOf(r.field);
    if (!f.values || f.type === 'boolean') return null;
    return valuesFor(f.values, root.type).then(list => list.forEach(v => titles.set(f.key + ':' + v.key, v.title)), () => {});
  }));
  await loadTitles(root.rules);

  // --- Wording ---------------------------------------------------------------

  function valueText(f, op, v) {
    if (f.type === 'date') {
      const preset = DATE_PRESETS.find(p => p[0] === v);
      if (preset) return op === '>>=' ? 'in the last ' + preset[1] : 'more than ' + preset[1] + ' ago';
      return (op === '>>=' ? 'after ' : 'before ') + v;
    }
    if (f.subType === 'rating') return '★'.repeat(Math.round(Number(v) / 2)) || '0';
    return titles.get(f.key + ':' + v) || v;
  }

  function describe(r) {
    if (r.rules) return (r.match === 'any' ? 'Any of: ' : 'All of: ') + (r.rules.map(describe).join(r.match === 'any' ? ' or ' : ', ') || 'nothing yet');
    const f = fieldOf(r.field);
    const op = opsOf(f).find(o => o.key === r.op);
    if (f.type === 'boolean') return f.title + ' ' + (op ? op.title : r.op);
    if (f.type === 'date') return f.title + ' ' + valueText(f, r.op, r.value);
    return f.title + ' ' + (op ? op.title : r.op) + ' ' + valueText(f, r.op, r.value);
  }

  const sortLabel = () => {
    if (!root.sort) return 'Sort: as the library';
    const desc = /:desc$/.test(root.sort);
    const key = root.sort.replace(/:desc$/, '');
    const s = meta.sorts.find(x => x.key === key);
    return 'Sort: ' + (s ? s.title : key) + (desc ? '  ↓' : '  ↑');
  };
  const limitLabel = () => 'Limit: ' + (root.limit ? 'the first ' + root.limit : 'none');
  const matchLabel = g => (g.match === 'any' ? 'Match any of these' : 'Match all of these');

  // --- The editor --------------------------------------------------------------

  let countGen = 0;
  function recount(menu) {
    const gen = ++countGen;
    menu.setSubtitle('Counting…');
    matchCount(sectionKey, root).then(n => {
      if (gen === countGen) menu.setSubtitle(n + ' ' + noun + ' match' + (root.limit && n > root.limit ? ', the first ' + root.limit + ' kept' : '') + (dirty ? '  ·  not saved yet' : ''));
    }, () => { if (gen === countGen) menu.setSubtitle('Couldn\'t count: check the rules'); });
  }

  // Back closes a menu; picking a row closes it too, then runs the row. A row
  // sets acted, so only a real Back goes up a level.
  function open(group, focus, parent) {
    let acted = false;
    const act = fn => () => { acted = true; fn(); };
    const isRoot = !parent;
    const items = [];
    const pos = it => items.filter(Boolean).indexOf(it); // menus count rows without the separators
    if (isRoot) items.push({ icon: icons.sort, label: 'Name: ' + (title || '(none yet)'), run: act(() => rename(() => open(group, 0))) });
    const matchRow = {
      icon: icons.filter, label: matchLabel(group),
      run: act(() => { group.match = group.match === 'any' ? 'all' : 'any'; dirty = true; open(group, pos(matchRow), parent); }),
      adjust: () => { group.match = group.match === 'any' ? 'all' : 'any'; dirty = true; relabel(matchRow, matchLabel(group)); recount(menu); },
    };
    items.push(matchRow);
    group.rules.forEach((r, i) => {
      const row = { icon: r.rules ? icons.collection : icons.check, label: describe(r),
        run: act(() => (r.rules ? open(r, 0, () => open(group, pos(row), parent)) : ruleMenu(group, i, () => open(group, pos(row), parent)))) };
      items.push(row);
    });
    const addRow = { icon: icons.filter, label: 'Add a rule…', run: act(() => addRule(group, () => open(group, pos(addRow) + 1, parent))) };
    items.push(addRow);
    if (isRoot) {
      items.push({ icon: icons.collection, label: 'Add a group (rules of their own)…', run: act(() => {
        const g = { match: 'any', rules: [] };
        group.rules.push(g);
        dirty = true;
        addRule(g, () => open(g, 0, () => open(group, 0)));
      }) });
      const sortRow = { icon: icons.sort, label: sortLabel(), adjust: dir => { cycleSort(dir); relabel(sortRow, sortLabel()); },
        run: act(() => { flipSort(); open(group, pos(sortRow)); }) };
      const limitRow = { icon: icons.list, label: limitLabel(), adjust: dir => { cycleLimit(dir); relabel(limitRow, limitLabel()); recount(menu); },
        run: act(() => { cycleLimit(1); open(group, pos(limitRow)); }) };
      items.push(null, sortRow, limitRow, null);
      items.push({ icon: icons.check, label: collection ? 'Save' : 'Create collection', run: act(save) });
    } else {
      items.push(null, { icon: icons.close, label: 'Remove this group', run: act(() => {
        const list = findParentRules(root, group);
        if (list) list.splice(list.indexOf(group), 1);
        dirty = true;
        parent();
      }) });
    }
    const menu = showMenu({
      title: isRoot ? (collection ? 'Edit smart collection' : 'New smart collection') : 'A group of rules',
      subtitle: '', items, focus: Math.min(focus || 0, items.filter(Boolean).length - 1), oneLine: true,
      onClose: () => setTimeout(() => {
        if (acted) return;
        if (parent) parent();
        else if (dirty) confirmLeave(() => open(group, 0));
      }, 0),
    });
    recount(menu);
  }

  function findParentRules(g, target) {
    if (g.rules.indexOf(target) !== -1) return g.rules;
    for (const r of g.rules) if (r.rules) { const f = findParentRules(r, target); if (f) return f; }
    return null;
  }

  function cycleSort(dir) {
    const keys = [''].concat(meta.sorts.map(s => s.key));
    const cur = keys.indexOf(root.sort.replace(/:desc$/, ''));
    const next = keys[(Math.max(0, cur) + dir + keys.length) % keys.length];
    root.sort = next ? next + (/:desc$/.test(root.sort) || !root.sort ? ':desc' : '') : '';
    dirty = true;
  }
  function flipSort() {
    if (!root.sort) { cycleSort(1); return; }
    root.sort = /:desc$/.test(root.sort) ? root.sort.replace(/:desc$/, '') : root.sort + ':desc';
    dirty = true;
  }
  function cycleLimit(dir) {
    const i = Math.max(0, LIMITS.indexOf(root.limit));
    root.limit = LIMITS[(i + dir + LIMITS.length) % LIMITS.length];
    dirty = true;
  }

  async function rename(back) {
    const t = await showPrompt({ title: 'Name the collection', value: title, placeholder: 'Collection name' });
    if (t != null && t.trim()) { title = t.trim(); dirty = true; }
    back();
  }

  function confirmLeave(stay) {
    showMenu({ title: 'Leave without saving?', subtitle: 'Your changes to the rules are lost.', start: 0, items: [
      { icon: icons.restart, label: 'Keep editing', run: stay },
      { icon: icons.check, label: collection ? 'Save' : 'Create collection', run: save },
      { icon: icons.close, label: 'Leave', run: () => {} },
    ] });
  }

  // --- Rules -------------------------------------------------------------------

  function ruleMenu(group, i, back) {
    const r = group.rules[i];
    const f = fieldOf(r.field);
    let acted = false;
    const act = fn => () => { acted = true; fn(); };
    const items = [];
    if (opsOf(f).length > 1) items.push({ icon: icons.sort, label: 'Change the condition…', run: act(() => pickOp(f, op => { r.op = op; dirty = true; if (f.type === 'boolean') back(); else pickValue(f, op, v => { r.value = v; back(); }, back); }, back)) });
    if (f.type !== 'boolean') items.push({ icon: icons.filter, label: 'Change the value…', run: act(() => pickValue(f, r.op, v => { r.value = v; dirty = true; back(); }, back)) });
    items.push({ icon: icons.close, label: 'Remove this rule', run: act(() => { group.rules.splice(i, 1); dirty = true; back(); }) });
    showMenu({ title: describe(r), items, oneLine: true, onClose: () => setTimeout(() => { if (!acted) back(); }, 0) });
  }

  function addRule(group, back) {
    let acted = false;
    const fields = meta.fields.slice().sort((a, b) => a.title.localeCompare(b.title));
    showMenu({ title: 'Add a rule', subtitle: 'Which field?', oneLine: true, onClose: () => setTimeout(() => { if (!acted) back(); }, 0),
      items: fields.map(f => ({ label: f.title, run: () => {
        acted = true;
        pickOp(f, op => {
          if (f.type === 'boolean') { group.rules.push({ field: f.key, op, value: '1' }); dirty = true; back(); return; }
          pickValue(f, op, v => { group.rules.push({ field: f.key, op, value: v }); dirty = true; back(); }, back);
        }, back);
      } })) });
  }

  function pickOp(f, then, back) {
    const ops = opsOf(f);
    if (ops.length === 1) { then(ops[0].key); return; }
    let acted = false;
    showMenu({ title: f.title, subtitle: 'Which condition?', onClose: () => setTimeout(() => { if (!acted) back(); }, 0),
      items: ops.map(o => ({ label: f.type === 'date' ? (o.key === '>>=' ? 'is in the last… / after…' : 'is more than… ago / before…') : o.title,
        run: () => { acted = true; then(o.key); } })) });
  }

  async function pickValue(f, op, then, back) {
    let acted = false;
    const pick = (title, items, sub) => showMenu({ title, subtitle: sub, oneLine: true, items,
      onClose: () => setTimeout(() => { if (!acted) back(); }, 0) });
    const chosen = v => () => { acted = true; then(v); };
    if (f.type === 'date') {
      pick(f.title, DATE_PRESETS.map(p => ({ label: valueText(f, op, p[0]), run: chosen(p[0]) })).concat([{ label: 'A date…', run: async () => {
        acted = true;
        const d = await showPrompt({ title: f.title, placeholder: 'YYYY-MM-DD' });
        if (d && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) then(d.trim()); else back();
      } }]));
      return;
    }
    if (f.subType === 'rating') {
      pick(f.title, [1, 2, 3, 4, 5].map(n => ({ label: '★'.repeat(n), run: chosen(String(n * 2)) })));
      return;
    }
    if (f.values) {
      let list;
      try {
        list = await valuesFor(f.values, root.type);
      } catch (e) {
        error('values failed', f.key, e);
        list = [];
      }
      list.forEach(v => titles.set(f.key + ':' + v.key, v.title));
      if (list.length > BIG_LIST) {
        const q = await showPrompt({ title: f.title, placeholder: 'A few letters of the name' });
        if (!q || !q.trim()) { back(); return; }
        const needle = q.trim().toLowerCase();
        list = list.filter(v => v.title.toLowerCase().indexOf(needle) !== -1).slice(0, 200);
      }
      if (list.length) {
        pick(f.title, list.map(v => ({ label: v.title, run: chosen(v.key) })), list.length + ' to choose from');
        return;
      }
      if (f.type !== 'string' && f.type !== 'integer') { back(); return; }
    }
    // Typed: text, or a number.
    const number = f.type === 'integer';
    const v = await showPrompt({ title: f.title + (number && f.subType === 'duration' ? ' (minutes)' : ''), placeholder: number ? 'A number' : 'Text' });
    if (v == null || !v.trim() || (number && !/^\d+$/.test(v.trim()))) { back(); return; }
    then(number && f.subType === 'duration' ? String(Number(v.trim()) * 60000) : v.trim());
  }

  // --- Saving ------------------------------------------------------------------

  async function save() {
    if (!title) {
      const t = await showPrompt({ title: 'Name the collection', placeholder: 'Collection name' });
      if (!t || !t.trim()) { open(root, 0); return; }
      title = t.trim();
    }
    const uri = contentUri(sectionKey, root);
    try {
      if (collection) {
        await request(server.uri + '/library/collections/' + collection.ratingKey + '/items', { method: 'PUT', token: server.token, params: { uri } });
        if (title !== collection.title) {
          await server.renameCollection(sectionKey, collection.ratingKey, title);
          renameShelf(collection.ratingKey, title);
        }
      } else {
        await request(server.uri + '/library/collections', { method: 'POST', token: server.token,
          params: { type: root.type, title, smart: 1, sectionId: sectionKey, uri } });
      }
      server.invalidate();
      dirty = false;
      onDone();
    } catch (e) {
      error('smart collection save failed', e);
      showMenu({ title: e.status === 409 ? 'That name is taken' : 'Couldn\'t save it', subtitle: e.status === 409 ? 'Try another name.' : e.message,
        items: [{ icon: icons.check, label: 'Back to the rules', run: () => open(root, 0) }] });
    }
  }

  open(root, 0);
}
