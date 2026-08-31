// Output invariants that must hold for EVERY profile, asserted against the nested shape the API
// returns. (Replaces a suite written for a flat one-row rendering that was removed 2026-08-31.)
// NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { KEYS, SECTIONS, byKey } from '../src/schema.mjs';
import { parseProfile } from '../src/profile-graph.mjs';

// A fresh clone has no captures/ -- gitignored, real people's data. Return nothing so each test
// skips rather than throwing.
const profiles = () => (existsSync('captures') ? readdirSync('captures') : [])
  .filter((d) => d.startsWith('profile-'))
  .map((d) => `captures/${d}/raw.json`).filter(existsSync)
  .map((f) => parseProfile(JSON.parse(readFileSync(f, 'utf8'))).profile);

test('conformance: the key set is identical for every profile', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  // a shape that varies per profile is not a shape -- a consumer cannot rely on it
  const expected = [...KEYS].sort();
  for (const p of ps) assert.deepEqual(Object.keys(p).sort(), expected);
});

test('conformance: every list field is an array, never null', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  // an empty section is [] with state:"complete" -- never null, which would be indistinguishable
  // from a section we failed to resolve
  for (const p of ps) for (const s of SECTIONS) {
    assert.ok(Array.isArray(p[s]), `${s} must be an array, got ${p[s] === null ? 'null' : typeof p[s]}`);
  }
});

test('conformance: list elements only use declared keys', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  for (const p of ps) for (const s of SECTIONS) {
    for (const item of p[s]) for (const k of Object.keys(item ?? {})) {
      assert.ok(byKey[s].item.includes(k), `${s}[] has undeclared key "${k}"`);
    }
  }
});

test('conformance: URL fields hold URLs on the host the name implies', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  for (const p of ps) {
    if (p.url) assert.match(p.url, /^https:\/\/www\.linkedin\.com\/in\//);
    for (const e of p.experience) {
      // /school/ is valid here, not a bug: when the employer IS a university, LinkedIn resolves
      // the company slot to its school page. Asserting /company/ alone fails on any academic.
      if (e.companyLinkedinUrl) {
        assert.match(e.companyLinkedinUrl, /^https:\/\/www\.linkedin\.com\/(company|school)\//);
      }
    }
    for (const e of p.education) {
      if (e.schoolLinkedinUrl) assert.match(e.schoolLinkedinUrl, /^https:\/\/www\.linkedin\.com\/(school|company)\//);
    }
  }
});

test('conformance: the id is bare and the URN is a URN', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  for (const p of ps) {
    assert.doesNotMatch(p.profileId, /^urn:/, 'profileId must be bare');
    assert.match(p.profileId, /^ACoAA/, 'profileId should be a member id');
  }
});

test('conformance: publicIdentifier agrees with the profile URL', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  for (const p of ps) assert.ok(p.url.includes(`/in/${p.publicIdentifier}`), p.url);
});

test('conformance: a dateRange always carries its display text', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  // `.text` is what the page shows; start/end are the parsed halves. A range without text is a
  // parse that half-worked.
  for (const p of ps) for (const s of SECTIONS) {
    for (const item of p[s]) {
      if (!item?.dates) continue;
      assert.equal(typeof item.dates.text, 'string');
      assert.ok(item.dates.text.length > 0, `${s}[] has a dateRange with no text`);
    }
  }
});

test('conformance: current and previous positions are distinct records', (t) => {
  const ps = profiles().filter((p) => p.experience.length > 1);
  if (!ps.length) return t.skip('no fixture with multiple positions');
  for (const p of ps) {
    const [a, b] = p.experience;
    assert.ok(a.title !== b.title || a.company !== b.company || a.dates?.text !== b.dates?.text,
      'the first two positions are the same record');
  }
});

test('conformance: no string field leaks an AttributedText wrapper', (t) => {
  const ps = profiles(); if (!ps.length) return t.skip('no captures');
  // {text, attributes} must be unwrapped; leaving it wrapped is a documented trap
  const seen = JSON.stringify(ps);
  assert.doesNotMatch(seen, /"attributes":\[/, 'an AttributedText wrapper survived into the output');
  assert.doesNotMatch(seen, /multiLocale/, 'a multiLocale sibling survived into the output');
});
