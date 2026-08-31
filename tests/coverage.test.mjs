// Field-coverage proof.
//
// Per-profile counts are meaningless on their own -- nobody has every section. What matters is
// whether each field CAN be filled, and for any that never fills, whether that is a genuine
// absence in the data or a gap in our mapping. This asserts the former across the fixture set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseProfile } from '../src/profile-graph.mjs';
import { KEYS, SECTIONS, UNAVAILABLE, ENRICHMENT } from '../src/schema.mjs';

const FIXTURES = ['deep-history', 'truncated-and-unresolved', 'unresolved-media',
                  'complete-at-cap', 'sparse'];

const profileFor = (h) => {
  const p = `captures/profile-${h}/raw.json`;
  if (!existsSync(p)) return null;
  return parseProfile(JSON.parse(readFileSync(p, 'utf8'))).profile;
};

// Fields that cannot be filled from the single profile request. Each must be justified, not
// merely absent -- an unexplained empty field is the failure mode this whole project guards.
// A field that never populates must be a KNOWN gap, never a silent mapping bug. `ENRICHMENT`
// names the ?enrich= flag that fills each; anything else appearing here is a defect.
const NEEDS_ENRICHMENT = ENRICHMENT;

test('coverage: every declared field is populated on at least one real profile', (t) => {
  const seen = new Map();
  let n = 0;
  for (const h of FIXTURES) {
    const f = profileFor(h);
    if (!f) continue;
    n++;
    for (const [k, v] of Object.entries(f)) {
      if (v != null && v !== '') seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  // A fresh clone has no captures/ (it is gitignored — real people's profile data).
  // Skip rather than fail: an absent fixture is a setup state, not a defect.
  if (n === 0) return t.skip('no captures on disk — see docs/TESTING.md to re-capture');
  assert.ok(n >= 4, `expected several fixtures, found ${n}`);

  const all = KEYS;
  const never = all.filter(k => !seen.has(k));


  // Anything else that never populates must be a KNOWN enrichment gap, never a silent mapping bug.
  const unexplained = never.filter(k => !(k in NEEDS_ENRICHMENT));
  assert.deepEqual(unexplained, [],
    `fields that never populate and have no documented reason: ${unexplained.join(', ')}`);

  const proven = all.length - never.length;
  // 32 declared; the only ones that cannot fill from a single request are the enrichment two
  assert.ok(proven >= KEYS.length - Object.keys(ENRICHMENT).length,
    `expected >=${KEYS.length - Object.keys(ENRICHMENT).length} proven fields, got ${proven}`);
});


test('coverage: the live Worker response agrees with the offline parser', (t) => {
  const p = 'captures/live-response-complete-at-cap.json';
  if (!existsSync(p)) return t.skip('no live capture');
  const live = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(live.ok, true);
  assert.equal(live.meta.upstreamRequests, 1, 'one upstream request per profile');

  // This fixture was captured with ?format=flat, a rendering removed on 2026-08-31, so its
  // `profile` cannot be compared field-by-field against a nested parse. `meta` is
  // format-independent and is the part that actually proves the deployed path and the tested
  // path are the same code: it is produced by parseProfile, not by any renderer.
  const offline = parseProfile(JSON.parse(readFileSync('captures/profile-complete-at-cap/raw.json', 'utf8'))).meta;
  assert.equal(live.meta.state, offline.state, 'live/offline disagree on state');
  assert.deepEqual(live.meta.truncated, offline.truncated);
  assert.deepEqual(live.meta.unresolved, offline.unresolved);
  // Compare live -> offline, not the reverse: the parser has GAINED collections since this was
  // captured (featuredMedia became tracked so the `unresolved` state could fire), and a fixture
  // lacking a later addition is not a regression. What must hold is that nothing the live
  // response DID report has changed underneath it.
  for (const [k, v] of Object.entries(live.meta.collections)) {
    assert.deepEqual(offline.collections[k], v, `live/offline mismatch on collections.${k}`);
  }
});

test('coverage: enrich=counts fills the connection count from the rendered document', (t) => {
  const p = 'captures/live-counts-complete-at-cap.json';
  if (!existsSync(p)) return t.skip('no live counts capture');
  const d = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(d.ok, true);
  assert.equal(d.meta.upstreamRequests, 2, 'profile + document');
  assert.equal(d.meta.enrichmentSkipped ?? null, null, 'the document surface must be reachable');

  // "500+" is a FLOOR. The literal is preserved so 500 is never mistaken for exact.
  assert.equal(d.profile.connectionsText, '500+');
  assert.equal(d.profile.connections, 500);
  // This member displays no follower count -- null means "not shown", never 0. enrich=social
  // is the source that does carry it.
  assert.equal(d.profile.followers, null);
});

test('coverage: social and counts cover different fields', () => {
  const s = 'captures/live-social-complete-at-cap.json', c = 'captures/live-counts-complete-at-cap.json';
  if (!existsSync(s) || !existsSync(c)) return;
  const social = JSON.parse(readFileSync(s, 'utf8')).profile;
  const counts = JSON.parse(readFileSync(c, 'utf8')).profile;
  // Neither alone is sufficient: social has followers, counts has connections.
  assert.ok(typeof social.followers === 'number' && social.followers > 0);
  assert.equal(social.connections ?? null, null);
  assert.ok(typeof counts.connections === 'number');
  assert.equal(counts.followers, null);
});

test('coverage: enrich=company resolves the company website', (t) => {
  const p = 'captures/live-company-final.json';
  if (!existsSync(p)) return t.skip('no live company capture');
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const c = d.profile.company;
  assert.equal(d.meta.enrichmentSkipped ?? null, null);
  assert.equal(d.meta.upstreamRequests, 2, 'profile + company');

  // Ground truth: the company page HTML carries "websiteUrl":"ontross.com".
  // LinkedIn stores a bare domain; we normalise to a URL.
  assert.equal(c.websiteUrl, 'https://ontross.com');
  assert.equal(c.matched, true, 'must select the requested company, not the first in the payload');
  assert.equal(c.universalName, 'ontross');

  // The LinkedIn PAGE must never be returned as the website -- they are different fields.
  assert.match(c.linkedinUrl, /linkedin\.com\/company\//);
  assert.ok(!/linkedin\.com/.test(c.websiteUrl));
});
