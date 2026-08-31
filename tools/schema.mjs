// INTERNAL maintenance tool. Not part of the API -- it exists so a field can be added in one
// place and we are TOLD, rather than having to remember, where else it must land.
//
//   node tools/schema.mjs           list every declared field
//   node tools/schema.mjs check     fail (exit 1) if the parser and src/schema.mjs disagree
//   node tools/schema.mjs docs      regenerate docs/SCHEMA.md
//
// `check` is also run by tests/schema.test.mjs, so drift fails the suite rather than waiting to
// be noticed. It validates the NESTED profile -- the shape the API actually returns.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FIELDS, KEYS, GROUPS, SECTIONS, byKey, UNAVAILABLE, ENRICHMENT } from '../src/schema.mjs';
import { parseProfile } from '../src/profile-graph.mjs';

// CLI behaviour only when invoked directly: this module is imported by the test suite, and
// running `list` + process.exit(0) on import once killed the test process during module load,
// silently skipping five tests while the suite still reported green.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const cmd = process.argv[2] ?? 'list';

const captures = () => (existsSync('captures') ? readdirSync('captures') : [])
  .filter((d) => d.startsWith('profile-'))
  .map((d) => `captures/${d}/raw.json`).filter(existsSync)
  .map((f) => parseProfile(JSON.parse(readFileSync(f, 'utf8'))).profile);

/* ----------------------------------------------------------------- check ---- */
export function check() {
  const fail = [];
  const profiles = captures();

  for (const p of profiles) {
    const got = Object.keys(p);
    for (const k of KEYS) if (!got.includes(k)) fail.push(`declared but not emitted: ${k}`);
    for (const k of got) if (!KEYS.includes(k)) fail.push(`emitted but not declared: ${k}`);

    for (const s of SECTIONS) {
      if (!Array.isArray(p[s])) { fail.push(`${s} must be an array, got ${typeof p[s]}`); continue; }
      const declared = byKey[s].item ?? [];
      for (const item of p[s]) {
        for (const ik of Object.keys(item ?? {})) {
          if (!declared.includes(ik)) fail.push(`${s}[] has undeclared key "${ik}"`);
        }
      }
    }
    for (const f of FIELDS) {
      if (f.type === 'array' || p[f.key] === null || p[f.key] === undefined) continue;
      const t = typeof p[f.key];
      if (!f.type.split('|').includes(t)) fail.push(`${f.key} is ${t}, declared ${f.type}`);
    }
  }

  for (const [k, v] of Object.entries(UNAVAILABLE)) {
    if (!v?.reason) fail.push(`UNAVAILABLE.${k} has no reason`);
    if (KEYS.includes(k)) fail.push(`${k} is declared unavailable but also emitted`);
  }
  for (const k of Object.keys(ENRICHMENT)) {
    if (!KEYS.includes(k)) fail.push(`ENRICHMENT names ${k}, which is not declared`);
  }

  const dupes = KEYS.filter((k, i) => KEYS.indexOf(k) !== i);
  for (const d of new Set(dupes)) fail.push(`duplicate key: ${d}`);
  for (const f of FIELDS) {
    if (!f.group) fail.push(`no group: ${f.key}`);
    if (!f.label) fail.push(`no label: ${f.key}`);
    if (!f.type)  fail.push(`no type: ${f.key}`);
  }
  return [...new Set(fail)];
}

/* ------------------------------------------------------------------ list ---- */
if (isMain && cmd === 'list') {
  for (const g of GROUPS) {
    console.log(`\n${g}`);
    for (const f of FIELDS.filter((x) => x.group === g)) {
      console.log(`  ${f.key.padEnd(20)} ${f.type.padEnd(14)} ${f.label}`);
      if (f.item) console.log(`  ${''.padEnd(20)} ${''.padEnd(14)} item: { ${f.item.join(', ')} }`);
    }
  }
  console.log(`\n${FIELDS.length} fields · ${SECTIONS.length} list sections · `
    + `${Object.keys(UNAVAILABLE).length} not obtainable`);
  process.exit(0);
}

/* ----------------------------------------------------------------- docs ---- */
if (isMain && cmd === 'docs') {
  const cell = (v) => String(v ?? '—').replace(/\|/g, '\\|');
  const cost = (k) => (ENRICHMENT[k] ? `➕ \`?enrich=${ENRICHMENT[k]}\`` : '✅ the single request');

  const scalars = FIELDS.filter((f) => f.type !== 'array')
    .map((f) => `| \`${f.key}\` | \`${cell(f.type)}\` | ${cell(f.label)} | ${cost(f.key)} | ${cell(f.source)} |`).join('\n');
  const lists = FIELDS.filter((f) => f.type === 'array')
    .map((f) => `| \`${f.key}\` | ${cell(f.label)} | \`{ ${f.item.join(', ')} }\` | ${cell(f.source)} |`).join('\n');
  const unavail = Object.entries(UNAVAILABLE)
    .map(([k, v]) => `| \`${k}\` | ${cell(v.reason)} |`).join('\n');

  writeFileSync('docs/SCHEMA.md', `# Schema — the shape the API returns

**Generated from \`src/schema.mjs\`. Do not edit by hand** — run \`node tools/schema.mjs docs\`.

There is **one** output shape: the nested profile object. ${FIELDS.length} fields —
${FIELDS.length - SECTIONS.length} scalars and ${SECTIONS.length} lists — all from a **single**
upstream request unless marked otherwise.

| | meaning |
|---|---|
| ✅ | comes from the single profile request |
| ➕ | needs an enrichment: one additional upstream request, never implicit |

## Scalars

| field | type | means | cost | source in the payload |
|---|---|---|---|---|
${scalars}

## Lists

Every one is returned **in full** — every position, not just the two most recent. \`meta.collections\`
reports \`complete\` / \`truncated\` / \`unresolved\` per list, because LinkedIn caps them server-side
without saying so and \`paging.total\` is the only discriminator.

| field | means | item shape | source in the payload |
|---|---|---|---|
${lists}

## Not obtainable

Declared with a reason rather than emitted as \`null\` — a null would read as "this person has
none", which is a different claim from "we cannot get this".

| field | why |
|---|---|
${unavail}
`);
  console.log(`docs/SCHEMA.md regenerated — ${FIELDS.length} fields, ${SECTIONS.length} lists`);
  process.exit(0);
}

if (isMain && cmd === 'check') {
  const fail = check();
  if (fail.length) {
    console.error(`✖ schema drift (${fail.length})`);
    for (const f of fail) console.error(`   ${f}`);
    process.exit(1);
  }
  console.log(`✓ ${FIELDS.length} fields — parser output and src/schema.mjs agree`);
}
