// Regression suite over SAVED API RESPONSES (the `{ok, profile, unavailable, meta}` envelope), as
// opposed to regression.test.mjs which re-parses raw Voyager payloads.
//
// Why a separate file: these fixtures were captured through `GET /profile`, which does not
// expose the raw upstream body, so they cannot be fed to parseProfile(). They pin the CONTRACT
// -- meta shape, the three-state discriminator, flat coverage -- rather than the parser.
//
// NO network. Skips cleanly when captures/ is absent (it is gitignored: real people's data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { KEYS, UNAVAILABLE } from '../src/schema.mjs';

const load = (h) => {
  const p = `captures/profile-${h}/profile.json`;
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, 'utf8'));
  return r?.ok && r.meta ? r : null;   // error envelopes are not fixtures
};

// the field list comes from the single declaration, not a vendor's transcribed column list

// Fixture roles (verified, not assumed):
//   truncated-skills  skills 20/53 truncated + featuredMedia 0/2 unresolved
//   truncated-and-unresolved  skills 20/29 truncated + featuredMedia 2/8 unresolved  <- also both
//   deep-history          experience 10/12 + skills 20/36 truncated, none unresolved
//   pearl           featuredMedia 0/10 unresolved, none truncated
// wessam is a second independent both-at-once case, not the only one.
const W = 'truncated-skills';

test('api-output: wessam is one upstream request and reports partial', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture — see docs/TESTING.md');
  assert.equal(r.meta.upstreamRequests, 1);
  assert.equal(r.meta.state, 'partial');
});

test('api-output: skills truncate at the cap with total > returned', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  const s = r.meta.collections.skills;
  assert.equal(s.returned, 20);
  assert.equal(s.total, 53);
  assert.equal(s.cap, 20);
  // the discriminator: total > returned AND returned >= cap  =>  truncated, not unresolved
  assert.ok(s.total > s.returned && s.returned >= s.cap);
  assert.equal(s.truncated, true);
  assert.equal(s.unresolved, false);
  assert.ok(r.meta.truncated.includes('skills (20/53)'));
});

test('api-output: featuredMedia is unresolved, not merely truncated', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  const f = r.meta.collections.featuredMedia;
  assert.equal(f.returned, 0);
  assert.equal(f.total, 2);
  // total > returned AND returned < cap  =>  failed decoration, NOT a page boundary
  assert.ok(f.total > f.returned && f.returned < f.cap);
  assert.equal(f.unresolved, true);
  assert.equal(f.truncated, false);
  assert.ok(r.meta.unresolved.includes('featuredMedia (0/2)'));
});

test('api-output: truncated and unresolved are distinct lists on one payload', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  assert.ok(r.meta.truncated.length >= 1, 'expected a truncated collection');
  assert.ok(r.meta.unresolved.length >= 1, 'expected an unresolved collection');
  const overlap = r.meta.truncated.filter((x) => r.meta.unresolved.includes(x));
  assert.deepEqual(overlap, [], 'a collection must never be both at once');
});

test('api-output: complete collections never appear in either list', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  for (const [k, v] of Object.entries(r.meta.collections)) {
    if (v.state !== 'complete') continue;
    assert.equal(v.truncated, false, `${k} is complete but flagged truncated`);
    assert.equal(v.unresolved, false, `${k} is complete but flagged unresolved`);
    assert.equal(v.returned, v.total, `${k} is complete but returned !== total`);
  }
});

test('api-output: the response carries every declared field', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  const missing = KEYS.filter((k) => !(k in r.profile));
  assert.deepEqual(missing, [], 'response is missing declared fields');
});

test('api-output: professionalEmail is declared unavailable, never invented', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  assert.equal('professionalEmail' in r.profile, false);
  assert.ok(UNAVAILABLE.professionalEmail?.reason, 'must be declared with a reason');
});

test('api-output: a truncated collection still yields exactly `returned` items', (t) => {
  const r = load(W);
  if (!r) return t.skip('no truncated-skills capture');
  // guards against a parser that reports truncation but silently drops or duplicates rows
  assert.equal(r.profile.skills.length, r.meta.collections.skills.returned);
  assert.equal(r.profile.education.length, r.meta.collections.education.returned);
});
