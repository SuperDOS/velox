// Smart collections: a collection that fills itself from rules, as Plex Web's
// advanced filters make them. The rules live in the collection's content URI
// as a library filter query, e.g. type=1&push=1&genre=4&or=1&genre=5&pop=1&year>>=2000&limit=20&sort=year:desc:
// key + operator + value per rule; or=1 between rules makes a group "any";
// push=1 … pop=1 is a group of its own. The library tells us its fields and
// which operators each kind takes (includeMeta), so nothing here is hard-coded
// per field.
import { session } from '../session.js';
import { request } from './client.js';

// Operators, longest first so "!==" isn't read as "!=" plus "=".
const OPS = ['!==', '>>=', '<<=', '==', '!=', '<=', '>=', '='];
const RULE = new RegExp('^([A-Za-z0-9.]+?)(' + OPS.map(o => o.replace(/[<>=!]/g, c => '\\' + c)).join('|') + ')(.*)$');
const RESERVED = { type: 1, sort: 1, limit: 1, push: 1, pop: 1, or: 1 };

// { match: 'all' | 'any', rules: [rule | group] }, rule: { field, op, value }.
export function parseFilter(query) {
  const tokens = String(query || '').replace(/^[^?]*\?/, '').split('&').filter(Boolean);
  const root = { match: 'all', rules: [], sort: '', limit: 0, type: 1 };
  let i = 0;
  const group = into => {
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t === 'push=1') { const g = { match: 'all', rules: [] }; into.rules.push(g); group(g); continue; }
      if (t === 'pop=1') return;
      if (t === 'or=1') { into.match = 'any'; continue; }
      const eq = t.indexOf('=');
      const name = eq > 0 ? t.slice(0, eq) : t;
      if (RESERVED[name] && into === root) {
        const v = decodeURIComponent(t.slice(eq + 1));
        if (name === 'sort') root.sort = v;
        else if (name === 'limit') root.limit = Number(v) || 0;
        else if (name === 'type') root.type = Number(v) || 1;
        continue;
      }
      const m = RULE.exec(t);
      if (m) into.rules.push({ field: m[1], op: m[2], value: decodeURIComponent(m[3].replace(/\+/g, ' ')) });
    }
  };
  group(root);
  return root;
}

function groupQuery(g) {
  return g.rules.map(r => (r.rules ? 'push=1&' + groupQuery(r) + '&pop=1' : r.field + r.op + encodeURIComponent(r.value)))
    .filter(Boolean).join(g.match === 'any' ? '&or=1&' : '&');
}

// The query after "all?" (without the server:// prefix).
export function filterQuery(root) {
  return ['type=' + root.type, groupQuery(root), root.limit ? 'limit=' + root.limit : '', root.sort ? 'sort=' + root.sort : '']
    .filter(Boolean).join('&');
}

export function contentUri(sectionKey, root) {
  return 'server://' + session.server.id + '/com.plexapp.plugins.library/library/sections/' + sectionKey + '/all?' + filterQuery(root);
}

// How many titles the rules find (before the limit).
export async function matchCount(sectionKey, root) {
  const q = filterQuery(Object.assign({}, root, { limit: 0, sort: '' }));
  const s = session.server;
  const json = await request(s.uri + '/library/sections/' + sectionKey + '/all?' + q + '&X-Plex-Container-Start=0&X-Plex-Container-Size=0', { token: s.token });
  const mc = json.MediaContainer || json;
  return mc.totalSize != null ? mc.totalSize : mc.size || 0;
}

// The library's fields for this kind of item: { fields: [{ key, title, type, subType, values }],
// ops: { type: [{ key, title }] }, sorts: [{ key, title, descKey }] }. Cached.
const metaCache = new Map();
export async function fieldsFor(sectionKey, type) {
  const id = sectionKey + ':' + type;
  if (metaCache.has(id)) return metaCache.get(id);
  const mc = await session.server.get('/library/sections/' + sectionKey + '/all', {
    type, includeMeta: 1, 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0,
  });
  const meta = mc.Meta || {};
  const T = (meta.Type || []).find(t => String(t.type) === String(type) || t.key === String(type)) ||
    (meta.Type || []).find(t => (t.Field || []).length) || {};
  const filters = new Map((T.Filter || []).map(f => [f.filter, f.key]));
  const ops = {};
  (meta.FieldType || []).forEach(ft => { ops[ft.type] = ft.Operator || []; });
  const out = {
    fields: (T.Field || []).map(f => ({ key: f.key, title: f.title, type: f.type, subType: f.subType, values: filters.get(f.key) || null })),
    ops,
    sorts: (T.Sort || []).map(s => ({ key: s.key, title: s.title, descKey: s.descKey || s.key + ':desc' })),
  };
  metaCache.set(id, out);
  return out;
}

// A field's values ([{ key, title }]) from the library, e.g. its genres. Cached.
const valueCache = new Map();
export async function valuesFor(path, type) {
  const id = path + ':' + type;
  if (!valueCache.has(id)) {
    valueCache.set(id, session.server.get(path, { type }).then(mc => (mc.Directory || []).map(d => ({ key: String(d.key), title: d.title })),
      e => { valueCache.delete(id); throw e; }));
  }
  return valueCache.get(id);
}

// Relative dates Plex understands ("-30d": 30 days ago).
export const DATE_PRESETS = [['-7d', '7 days'], ['-30d', '30 days'], ['-90d', '90 days'], ['-1y', 'a year'], ['-5y', '5 years']];
