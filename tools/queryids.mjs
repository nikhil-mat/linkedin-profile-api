#!/usr/bin/env node
// Extract LinkedIn's queryId registry from a web-client JS bundle.
//
//   node tools/queryids.mjs <bundle-file|url> [filter]
//   node tools/queryids.mjs bundle.js company          # only names containing "company"
//   node tools/queryids.mjs bundle.js --json > data/queryids.json
//
// The bundle registers every persisted query as
//   {kind:"query", id:"<resource>.<32-hex>", typeName:"…", name:"<human-readable-slug>"}
// so it is a self-documenting catalogue: hash -> what the query actually IS.
//
// Why this beats the alternatives:
//   * traffic capture  — needs a logged-in session, one endpoint at a time, and a correctly
//                        captured request can still be MISLABELLED by whoever wrote it down
//   * APK decompiling  — static, but Android field selections need `accept: application/json`
//   * this            — no cookies, no API call, no session; names included
// static.licdn.com is a plain CDN. Fetching it touches no authenticated surface.
import { readFileSync } from 'node:fs';

const [src, ...rest] = process.argv.slice(2);
if (!src) {
  console.error('usage: node tools/queryids.mjs <bundle-file|url> [filter] [--json]');
  process.exit(1);
}
const asJson = rest.includes('--json');
const filter = rest.find(a => !a.startsWith('--'))?.toLowerCase();

const text = /^https?:\/\//.test(src)
  ? await (await fetch(src, { headers: { 'user-agent': 'Mozilla/5.0' } })).text()
  : readFileSync(src, 'utf8');

const RE = /kind:"(query|mutation)",id:"([A-Za-z]+)\.([0-9a-f]{32})",typeName:"([^"]*)",name:"([^"]*)"/g;
const byId = new Map();
for (const [, kind, resource, hash, typeName, name] of text.matchAll(RE)) {
  byId.set(`${resource}.${hash}`, { kind, resource, hash, name, queryId: `${resource}.${hash}` });
}
let rows = [...byId.values()].sort((a, b) => a.resource.localeCompare(b.resource) || a.name.localeCompare(b.name));
if (filter) rows = rows.filter(r => (r.name + r.resource).toLowerCase().includes(filter));

if (asJson) {
  console.log(JSON.stringify({ source: src, capturedAt: new Date().toISOString().slice(0, 10),
                               count: rows.length, queries: rows }, null, 1));
} else {
  if (!rows.length) {
    console.error('No queries found. Wrong bundle — find the right one with:');
    console.error("  grep -oE 'https://static\\.licdn\\.com/[^\"]+\\.js' <saved-page.html> | sort -u");
    process.exit(2);
  }
  for (const r of rows) console.log(`${r.name.padEnd(58)} ${r.queryId}`);
  console.error(`\n${rows.length} ${filter ? `matching "${filter}"` : 'queries'} · ${new Set(rows.map(r => r.resource)).size} resources`);
}
