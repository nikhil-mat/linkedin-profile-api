// Normalise a `voyagerIdentityDashProfileComponents` section response into plain records.
//
// Shape of the live response (verified 2026-08-30):
//   data.data.identityDashProfileComponentsBySectionType.metadata.title  -> section title
//   included[] / nested `components.elements[]` -> one `entityComponent` per row
//
// entityComponent slots, consistently across every section type:
//   titleV2  -> primary line  (role title, school, skill name, certification name)
//   subtitle -> secondary     ("Company · Full-time", degree, issuer)
//   caption  -> dates         ("Jun 2025 - Present · 1 yr 3 mos")
//   metadata -> location      ("Bengaluru, Karnataka, India · On-site")
//   subComponents -> description, bullets, nested roles
//
// Every slot is a TextViewModel: { text, accessibilityText, … }. Slots are frequently
// absent; a missing slot yields null rather than a guessed value.

// A slot is a TextComponent wrapping a TextViewModel: { text: { text: "…" } }.
// Some slots are the TextViewModel directly. Unwrap either.
function txt(v, depth = 0) {
  if (depth > 6 || v == null || typeof v !== 'object') return null;
  if (typeof v.text === 'string') return v.text.trim() || null;
  if (v.text && typeof v.text === 'object') return txt(v.text, depth + 1);
  return null;
}

/** Depth-first search yielding every object matching `pred`. */
function* deepFind(node, pred, depth = 0) {
  if (depth > 60 || node == null || typeof node !== 'object') return;
  if (!Array.isArray(node) && pred(node)) yield node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) yield* deepFind(v, pred, depth + 1);
}

const isEntity = o => typeof o.$type === 'string' && o.$type.endsWith('EntityComponent');

/** Free text carried in an entity's subComponents (descriptions, bullets). */
function subText(entity) {
  const out = [];
  for (const t of deepFind(entity.subComponents ?? {}, o => o.$type?.endsWith('TextViewModel'))) {
    const s = txt(t);
    if (s) out.push(s);
  }
  return out;
}

/** Nested entities — e.g. several roles grouped under one company. */
function childEntities(entity) {
  return [...deepFind(entity.subComponents ?? {}, isEntity)];
}

export function parseSection(json) {
  const meta = json?.data?.data?.identityDashProfileComponentsBySectionType?.metadata ?? {};
  const seen = new Set();
  const rows = [];

  for (const e of deepFind(json, isEntity)) {
    if (seen.has(e)) continue;
    seen.add(e);
    if (e.isNullState) continue;

    const title = txt(e.titleV2);
    const subtitle = txt(e.subtitle);
    // A wrapper with no text of its own is not a row; let its children surface
    // as rows in their own right rather than swallowing them.
    if (!title && !subtitle) continue;

    const kids = childEntities(e);
    for (const k of kids) seen.add(k);      // children are emitted nested, not twice

    const row = {
      title,
      subtitle,
      caption: txt(e.caption),
      metadata: txt(e.metadata),
      logo: logoOf(e),
      description: subText(e).filter(s => s !== title && s !== subtitle),
    };
    if (kids.length) row.entries = kids.map(k => ({
      title: txt(k.titleV2), subtitle: txt(k.subtitle),
      caption: txt(k.caption), metadata: txt(k.metadata),
      description: subText(k),
    }));
    rows.push(row);
  }

  // The same entity can appear in both a paged list and a fixed "top" list
  // (skills does this). Key on the visible text to keep the first occurrence.
  const uniq = [];
  const keys = new Set();
  for (const r of rows) {
    const k = `${r.title}|${r.subtitle}|${r.caption}`;
    if (keys.has(k)) continue;
    keys.add(k);
    uniq.push(r);
  }

  return { section: meta.title ?? null, count: uniq.length, rows: uniq };
}

function logoOf(entity) {
  for (const a of deepFind(entity.image ?? {}, o => typeof o.fileIdentifyingUrlPathSegment === 'string')) {
    const root = a.rootUrl ?? '';
    return root + a.fileIdentifyingUrlPathSegment;
  }
  return null;
}
