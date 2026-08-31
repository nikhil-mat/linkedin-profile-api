// Follower and connection counts come from the RENDERED PROFILE PAGE, not from the Voyager
// decoration — which is why an exhaustive search of the API payload never found them. They are
// display text on the top card, so a page-scraping tool returns them
// while a pure API client does not.
//
// Cost: one extra request for the ~900 KB profile document.
// ⚠️ This surface is 999-BLOCKED from datacenter IPs. It only works from a residential egress —
// which is what our laptop-hosted / relay topology provides.
import { parseRows, createResolver, flightFromDocument, walk, textOf } from './flight.mjs';

// SDUI Text nodes are plain objects carrying typography props directly, so their text sits at
// `.children`, not `.props.children`. Element tuples put it under `.props`. Handle both.
function textRuns(node) {
  const out = [];
  for (const n of walk(node)) {
    const src = n?.props && 'fontFamily' in n.props ? n.props
              : (n && typeof n === 'object' && 'fontFamily' in n ? n : null);
    if (!src) continue;
    const t = textOf(src.children).join(' ').trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const num = (s) => {
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {string} html the profile document
 * @returns {{connections: number|null, connectionsText: string|null,
 *            followers: number|null, followersText: string|null}}
 */
export function topcardCounts(html) {
  let runs;
  try { runs = textRuns(createResolver(parseRows(flightFromDocument(html))).row('0')); }
  catch { return { connections: null, connectionsText: null, followers: null, followersText: null }; }

  const out = { connections: null, connectionsText: null, followers: null, followersText: null };

  for (let i = 0; i < runs.length; i++) {
    const label = runs[i];
    // The count is rendered as its own run immediately BEFORE the label ("500+", "connections").
    // A combined "1,234 followers" run is also accepted, since the split is a rendering detail.
    const combined = label.match(/^([\d,]+\+?)\s+(followers?|connections?)$/i);
    if (combined) {
      const key = /follower/i.test(combined[2]) ? 'followers' : 'connections';
      out[key] ??= num(combined[1]);
      out[`${key}Text`] ??= combined[1];
      continue;
    }
    if (!/^(followers?|connections?)$/i.test(label)) continue;
    const prev = runs[i - 1];
    if (!prev || !/^[\d,]+\+?$/.test(prev)) continue;
    const key = /follower/i.test(label) ? 'followers' : 'connections';
    out[key] ??= num(prev);
    out[`${key}Text`] ??= prev;   // "500+" is a range, not a number — keep the literal too
  }
  return out;
}
