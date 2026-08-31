// Optional enrichment from the ProfileComponents surface. Each of these costs ONE extra
// upstream request in production; the parsers here are verified offline against saved captures.
//
// SDUI render trees nest unpredictably (an endorsement count sits in a footer insightComponent
// several levels below its skill), so these deep-search each entity's own subtree rather than
// walking a fixed path that breaks whenever LinkedIn reshuffles the tree.

const SECTION_ROOT = (json) =>
  json?.data?.data?.identityDashProfileComponentsBySectionType   // double `data` wrap since 2026-04
  ?? json?.data?.identityDashProfileComponentsBySectionType
  ?? null;

function* walk(node, depth = 0) {
  if (depth > 60 || node == null || typeof node !== 'object') return;
  yield node;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') yield* walk(v, depth + 1);
  }
}

// Every readable string inside a subtree, in document order.
function* texts(node) {
  for (const n of walk(node)) {
    if (typeof n.text === 'string' && n.text.trim()) yield n.text.trim();
  }
}

// Q-NORMALIZED-RESOLVE: `data` holds references; the actual components live in `included[]`.
// Walking only the section root finds nothing at all.
const entities = (json) => {
  const roots = [SECTION_ROOT(json), json?.included].filter(Boolean);
  const out = [];
  for (const r of roots) {
    for (const n of walk(r)) {
      if (typeof n.$type === 'string' && n.$type.endsWith('EntityComponent')) out.push(n);
    }
  }
  return out;
};

// An entity's readable fields live in NAMED SLOTS (titleV2 / subtitle / caption), each a
// TextComponent wrapping a TextViewModel -- the string sits at `.text.text`. Relying on the
// positional order of texts instead put the follower count where the name belonged.
const slot = (v, depth = 0) => {
  if (depth > 6 || v == null || typeof v !== 'object') return null;
  if (typeof v.text === 'string') return v.text.trim() || null;
  if (v.text && typeof v.text === 'object') return slot(v.text, depth + 1);
  return null;
};

// Counts ("1 endorsement", "269,001 followers") hang off a footer InsightComponent below the
// entity, so they are found by scanning the subtree rather than by a fixed path.
const countIn = (entity, re) => {
  for (const t of texts(entity)) {
    const m = t.match(re);
    if (m) return Number(t.replace(/[^\d]/g, '')) || 0;
  }
  return null;
};

/** skills section -> [{ name, endorsements }] */
export function skillEndorsements(json) {
  const out = [], seen = new Set();
  for (const e of entities(json)) {
    const name = slot(e.titleV2);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, endorsements: countIn(e, /^\d[\d,]*\s+endorsement/i) ?? 0 });
  }
  return out;
}

/** interests section -> [{ name, headline, followers }] */
export function interests(json) {
  const out = [], seen = new Set();
  for (const e of entities(json)) {
    const name = slot(e.titleV2);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      headline: slot(e.subtitle),
      followers: countIn(e, /^\d[\d,]*\s+(followers?|members?)/i),
    });
  }
  return out;
}
