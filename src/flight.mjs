// React Flight (RSC) stream decoder for LinkedIn SDUI payloads.
//
// Grammar observed in LinkedIn's `window.__como_rehydration__` and in
// /flagship-web/rsc-action/actions/component responses:
//
//   <hexId>:I["<module>",[],"<export>"]   module import row
//   <hexId>:[...]                         serialized value row (usually an element tree)
//   ["$", type, key, props]               element tuple; type "$Lxx" = component from row xx
//   "$Lxx"                                lazy reference to row xx
//   "$undefined"                          undefined
//
// Rows are resolved lazily and memoised so reference cycles terminate.

const ROW = /^([0-9a-f]+):([IHE]?)(.*)$/;

export function parseRows(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const m = ROW.exec(line);
    if (!m) continue;
    const [, id, tag, rest] = m;
    if (tag === 'I') { rows.set(id, { kind: 'module', raw: rest }); continue; }
    try { rows.set(id, { kind: 'value', value: JSON.parse(tag + rest) }); }
    catch { rows.set(id, { kind: 'raw', raw: tag + rest }); }
  }
  return rows;
}

export function createResolver(rows) {
  const cache = new Map();
  const inflight = new Set();

  function row(id) {
    if (cache.has(id)) return cache.get(id);
    const r = rows.get(id);
    if (!r) return { $unresolved: id };
    if (inflight.has(id)) return { $cycle: id };
    inflight.add(id);
    const out = r.kind === 'value' ? resolve(r.value) : { $module: id };
    inflight.delete(id);
    cache.set(id, out);
    return out;
  }

  function resolve(v) {
    if (typeof v === 'string') {
      if (v === '$undefined') return undefined;
      if (v.startsWith('$L')) return row(v.slice(2));
      if (v === '$') return v;
      if (v.startsWith('$$')) return v.slice(1); // escaped literal
      return v;
    }
    if (Array.isArray(v)) {
      if (v[0] === '$') {
        return { $el: resolve(v[1]), key: v[2] ?? null, props: resolve(v[3]) ?? {} };
      }
      return v.map(resolve);
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) o[k] = resolve(val);
      return o;
    }
    return v;
  }

  return { row, resolve };
}

/** Extract the Flight stream embedded in a server-rendered profile document. */
export function flightFromDocument(html) {
  const at = html.indexOf('window.__como_rehydration__');
  if (at === -1) return null;
  const start = html.indexOf('[', at);
  const chunks = readJsonArray(html, start);
  return chunks.join('');
}

function readJsonArray(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('unterminated __como_rehydration__ array');
}

/** Depth-first walk over a resolved tree. */
export function* walk(node, depth = 0) {
  if (depth > 400 || node == null) return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n, depth + 1); return; }
  if (typeof node !== 'object') return;
  yield node;
  if (node.$el !== undefined) { yield* walk(node.props, depth + 1); return; }
  for (const v of Object.values(node)) yield* walk(v, depth + 1);
}

/** Props that never carry human-readable text. */
const NOISE_KEYS = new Set(['className', 'componentkey', 'componentKey', 'observabilityIdentifier',
  '$type', 'data-testid', 'data-component-type', 'data-sdui-component', 'style', 'href', 'src',
  'requestId', 'sduiid', 'trackingId', 'controlName', 'id', 'key']);

const NOISE_VALUE = /^(com\.linkedin|proto\.|urn:li|\$|https?:)|^[0-9a-f]{8}-[0-9a-f]{4}-/;

/** All visible text under a node, in document order. */
export function textOf(node, out = [], depth = 0, seen = new Set()) {
  if (depth > 400 || node == null) return out;
  if (typeof node === 'string') {
    const t = node.trim();
    if (t && !NOISE_VALUE.test(t)) out.push(t);
    return out;
  }
  if (Array.isArray(node)) { for (const n of node) textOf(n, out, depth + 1, seen); return out; }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);
  const src = node.$el !== undefined ? (node.props ?? {}) : node;
  for (const [k, v] of Object.entries(src)) {
    if (NOISE_KEYS.has(k)) continue;
    textOf(v, out, depth + 1, seen);
  }
  return out;
}

/** Find nodes whose props carry an SDUI componentKey matching `re`. */
export function findCards(tree, re) {
  const hits = [];
  for (const n of walk(tree)) {
    const key = n?.props?.componentKey || n?.componentKey;
    if (typeof key === 'string' && re.test(key)) hits.push({ key, node: n });
  }
  return hits;
}
