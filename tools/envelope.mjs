// Turn a saved raw Voyager capture into the same {ok, profile, flat, unavailable, meta} envelope
// that GET /profile returns, so the local console can render saved captures with NO network and
// NO budget. Offline only -- it never opens a socket.
//
//   node tools/envelope.mjs                 # every captures/profile-*/raw.json
//   node tools/envelope.mjs deep-history
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { parseProfile } from '../src/profile-graph.mjs';
import { UNAVAILABLE } from '../src/schema.mjs';

const handles = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('captures').filter((d) => d.startsWith('profile-')).map((d) => d.slice('profile-'.length));

let made = 0;
for (const h of handles) {
  const raw = `captures/profile-${h}/raw.json`;
  if (!existsSync(raw)) { console.log(`skip ${h} (no raw.json)`); continue; }
  const { profile, meta } = parseProfile(JSON.parse(readFileSync(raw, 'utf8')));
  const env = {
    ok: true,
    profile,
    unavailable: UNAVAILABLE,
    // `source` marks this as rebuilt from a capture, so a reader never mistakes it for a live
    // response. upstreamMs/egress are omitted rather than faked.
    meta: { ...meta, source: 'offline-fixture', rawFile: raw },
  };
  const out = `captures/profile-${h}/envelope.json`;
  writeFileSync(out, JSON.stringify(env, null, 2));
  const t = meta.truncated ?? [], u = meta.unresolved ?? [];
  console.log(`${h.padEnd(30)} ${meta.state.padEnd(9)} trunc=${t.length} unres=${u.length} -> ${out}`);
  made++;
}
console.log(`\n${made} envelope(s) written. No network used.`);
