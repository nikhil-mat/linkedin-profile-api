// src/schema.mjs is the single declaration of the API's output shape. This runs the same checks
// as `node tools/schema.mjs check`, so drift fails the suite instead of waiting to be noticed
// by someone running the tool by hand. NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { check } from '../tools/schema.mjs';
import { FIELDS, KEYS, SECTIONS, byKey, UNAVAILABLE, ENRICHMENT } from '../src/schema.mjs';

test('schema: the parser and the declaration agree, both directions', () => {
  // bidirectional: declared-but-not-emitted AND emitted-but-not-declared both fail, so adding a
  // field to the parser without declaring it is caught too
  const fail = check();
  assert.deepEqual(fail, [], `schema drift:\n  ${fail.join('\n  ')}`);
});

test('schema: every list field declares the shape of its elements', () => {
  assert.ok(SECTIONS.length > 0);
  for (const s of SECTIONS) {
    const item = byKey[s].item;
    assert.ok(Array.isArray(item) && item.length > 0, `${s} must declare its element keys`);
  }
});

test('schema: an unavailable field carries a reason and is never emitted', () => {
  assert.ok(Object.keys(UNAVAILABLE).length > 0);
  for (const [k, v] of Object.entries(UNAVAILABLE)) {
    assert.ok(v?.reason, `${k} must carry a reason`);
    // a null would read as "this person has none" -- a different claim from "we cannot get this"
    assert.equal(KEYS.includes(k), false, `${k} must not also be emitted`);
  }
});

test('schema: every enrichment-only field is itself declared', () => {
  for (const [k, flag] of Object.entries(ENRICHMENT)) {
    assert.ok(KEYS.includes(k), `ENRICHMENT names ${k}, which is not declared`);
    assert.ok(typeof flag === 'string' && flag.length, `${k} must name its enrich flag`);
  }
});

test('schema: every field has a unique key, a group, a label and a type', () => {
  assert.equal(new Set(KEYS).size, FIELDS.length);
  for (const f of FIELDS) {
    assert.ok(f.group, f.key); assert.ok(f.label, f.key); assert.ok(f.type, f.key);
  }
});

test('schema: docs/SCHEMA.md is in sync with the declaration', () => {
  // The doc is GENERATED. Asserting it is current stops prose quietly disagreeing with code.
  if (!existsSync('docs/SCHEMA.md')) return;
  const doc = readFileSync('docs/SCHEMA.md', 'utf8');
  for (const f of FIELDS) {
    assert.ok(doc.includes('`' + f.key + '`'),
      `docs/SCHEMA.md is missing ${f.key} — run: node tools/schema.mjs docs`);
  }
});
