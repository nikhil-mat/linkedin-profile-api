// Offline regression suite. Runs entirely against saved captures -- NO network, so it is safe
// to run while throttled, restricted, or with no session at all.
//
//   node --test tests/
//
// Every expectation below was verified live on 2026-08-30 (docs/10-TEST-PROFILES.md). Each one
// pins a bug that actually happened during development, not a hypothetical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseProfile } from '../src/profile-graph.mjs';

const load = (h) => {
  const p = `captures/profile-${h}/raw.json`;
  if (!existsSync(p)) return null;
  return parseProfile(JSON.parse(readFileSync(p, 'utf8')));
};

// Fixtures are named for what they EXERCISE, not whose profile they are. The captures hold real
// people's data and these expectations ship in the repo, so nothing identifying belongs here:
// names, locations and employers were removed 2026-08-31. captures/HANDLES.md (gitignored) maps
// each fixture back to its handle for re-capture.
//
// fixture -> expected shape. `counts` are the parser's OUTPUT lengths -- for experience that is
// flattened POSITIONS, while the truncation numbers below count position GROUPS. 7 groups can
// yield 10 positions, so the two differing is correct, not a bug.
const FIXTURES = {
  'deep-history': {
    about: true, state: 'partial',
    counts: { experience: 13, education: 8, skills: 20, publications: 13, honors: 8, languages: 2, certifications: 1, volunteering: 1 },
    truncated: { experience: [10, 12], skills: [20, 36] },
  },
  'truncated-and-unresolved': {
    about: true, state: 'partial',
    counts: { experience: 10, education: 5, skills: 20, patents: 7, certifications: 10, honors: 10, languages: 4, volunteering: 5, publications: 1 },
    truncated: { skills: [20, 29] },
  },
  'unresolved-media': {
    // `partial` because featuredMedia is unresolved (0 of 10) — the only collection on any
    // fixture that exercises the unresolved path.
    about: true, state: 'partial',
    counts: { experience: 6, education: 2, skills: 15, courses: 8, languages: 2, organizations: 1 },
    truncated: {},
  },
  'complete-at-cap': {
    about: false, state: 'complete',
    counts: { experience: 10, education: 1, skills: 14, certifications: 3, languages: 0 },
    truncated: {},   // 10/10 sits EXACTLY on the cap and must NOT read as truncated
  },
  'sparse': {
    about: false, state: 'complete',
    counts: { experience: 0, education: 1, skills: 0 },
    truncated: {},
  },
};

for (const [handle, exp] of Object.entries(FIXTURES)) {
  test(`${handle}: parses and matches baseline`, (t) => {
    const res = load(handle);
    if (!res) return t.skip('capture missing -- re-capture with `node profile.mjs ' + handle + '`');
    const { profile, meta } = res;

    // Shape, not identity. A real name and slug are personal data and pin nothing the
    // structural assertions below do not -- and an identity assertion breaks when someone
    // renames themselves, which is a false failure.
    assert.equal(typeof profile.name, 'string');
    assert.ok(profile.name.length > 0, 'name must be non-empty');
    assert.match(profile.publicIdentifier, /^[\w-]{2,100}$/, 'slug must look like a slug');
    assert.equal(!!profile.about, exp.about, 'about presence');

    for (const [k, n] of Object.entries(exp.counts)) {
      assert.equal(profile[k].length, n, `${k} count`);
    }

    // Truncation: the server capped the collection and more exist upstream.
    assert.equal(meta.state, exp.state, 'meta.state');
    for (const [k, [returned, total]] of Object.entries(exp.truncated)) {
      const c = meta.collections[k];
      assert.ok(c, `${k} should have paging`);
      assert.equal(c.truncated, true, `${k} must be flagged truncated`);
      assert.equal(c.returned, returned);
      assert.equal(c.total, total);
    }
    // Anything not listed as truncated must not claim to be.
    for (const [k, c] of Object.entries(meta.collections)) {
      if (!(k in exp.truncated)) assert.equal(c.truncated, false, `${k} must NOT be truncated`);
    }
  });
}

test('boundary: a collection sitting exactly on its cap is complete, not truncated', (t) => {
  const res = load('complete-at-cap');
  if (!res) return t.skip('capture missing');
  const c = res.meta.collections.experience;
  assert.equal(c.total, 10);
  assert.equal(c.returned, 10);
  assert.equal(c.cap, 10, 'position groups cap at 10');
  assert.equal(c.truncated, false, 'total === returned === cap must be complete');
});

test('regression: Organization uses positionHeld, not position', (t) => {
  const res = load('unresolved-media');
  if (!res) return t.skip('capture missing');
  const org = res.profile.organizations[0];
  // `position` silently yielded null for a field that had data.
  assert.equal(org.positionHeld, 'Member');
  assert.ok(org.institution?.length > 0, 'organization institution resolves');
  assert.equal(org.dates.start, '4/2011');
});

test('regression: course institution resolves through occupation -> education', (t) => {
  const res = load('unresolved-media');
  if (!res) return t.skip('capture missing');
  assert.ok(res.profile.courses.every(c => c.name && c.number), 'name + course code');
  assert.ok(res.profile.courses[0].institution?.length > 0, 'course institution resolves');
});

test('regression: position location is extracted where present', (t) => {
  const res = load('complete-at-cap');
  if (!res) return t.skip('capture missing');
  const withLoc = res.profile.experience.filter(e => e.location);
  // Sampling ONE Position record to decide the schema is how this was originally missed --
  // locationName is absent on some positions and present on others.
  assert.ok(withLoc.length >= 3, `expected several positions with a location, got ${withLoc.length}`);
  assert.ok(res.profile.experience.some(e => !e.location), 'and some genuinely without');
});

test('graph walk: experience belongs to the subject only, and is not duplicated', (t) => {
  for (const h of Object.keys(FIXTURES)) {
    const res = load(h); if (!res) continue;
    const keys = res.profile.experience.map(e => `${e.title}|${e.company}|${e.dates?.start}`);
    assert.equal(new Set(keys).size, keys.length, `${h}: duplicate experience rows`);
  }
});

test('images: built from the widest vectorImage artifact', (t) => {
  const res = load('complete-at-cap');
  if (!res) return t.skip('capture missing');
  for (const u of [res.profile.profilePicture, res.profile.coverImage]) {
    assert.match(u, /^https:\/\/media\.licdn\.com\/dms\/image\//);
    assert.ok(!u.includes('&amp;'), 'HTML entities must be unescaped');
  }
});

test('empty is distinguishable from missing: absent sections are [] not undefined', (t) => {
  const res = load('sparse');
  if (!res) return t.skip('capture missing');
  for (const k of ['experience','skills','languages','courses','projects','honors',
                   'publications','patents','organizations','volunteering','testScores']) {
    assert.ok(Array.isArray(res.profile[k]), `${k} must be an array`);
    assert.equal(res.profile[k].length, 0);
  }
  assert.equal(res.meta.state, 'complete', 'a genuinely sparse profile is complete, not partial');
});

test('drift telemetry: unknown $types are counted, never silently dropped', (t) => {
  const KNOWN_DRIFT = new Set([
    'com.linkedin.voyager.dash.identity.profile.StandardizedDegree',
    'com.linkedin.voyager.dash.relationships.MemberRelationship',
  ]);
  for (const h of Object.keys(FIXTURES)) {
    const res = load(h); if (!res) continue;
    for (const { type } of res.meta.unknownTypes) {
      assert.ok(KNOWN_DRIFT.has(type),
        `${h}: NEW unknown $type "${type}" -- LinkedIn changed something; verify then add it here`);
    }
  }
});

/* ------------------------------------------------- enrichment (offline fixtures) */
import { skillEndorsements, interests } from '../src/enrich.js';

const section = (name) => {
  const p = `captures/profile-complete-at-cap/${name}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

test('enrich: skill endorsements parse from the components section', (t) => {
  const j = section('skills');
  if (!j) return t.skip('capture missing');
  const rows = skillEndorsements(j);
  assert.equal(rows.length, 14, 'one row per skill');
  // Named slots, not positional text: relying on text order put the count where the name goes.
  assert.ok(rows.every(r => r.name && !/endorsement/i.test(r.name)), 'name must not be a count');
  const endorsed = rows.filter(r => r.endorsements > 0);
  assert.equal(endorsed.length, 3);
  assert.ok(endorsed.some(r => r.name === 'Web Development' && r.endorsements === 1));
});

test('enrich: interests parse with follower counts', (t) => {
  const j = section('interests');
  if (!j) return t.skip('capture missing');
  const rows = interests(j);
  assert.equal(rows.length, 23);
  assert.ok(rows.every(r => r.name && !/followers?|members?$/i.test(r.name)), 'name must not be a count');
  const withFollowers = rows.filter(r => typeof r.followers === 'number');
  assert.ok(withFollowers.length >= 15, `expected most to carry follower counts, got ${withFollowers.length}`);
  assert.ok(rows.some(r => r.name === 'LinkedIn' && r.followers > 30_000_000));
});

test('enrich: entities are found in included[], not only under the section root', (t) => {
  const j = section('skills');
  if (!j) return t.skip('capture missing');
  // Regression: walking only data.data.<root> returned zero entities.
  const rootOnly = { data: j.data };
  assert.equal(skillEndorsements(rootOnly).length, 0, 'root alone has no entities — included[] is required');
  assert.ok(skillEndorsements(j).length > 0);
});

/* --------------------------------------- topcard counts (rendered document, offline) */
import { topcardCounts } from '../src/topcard.js';

test('topcard: connection count comes from the document, not the API payload', (t) => {
  const docs = ['captures/2026-08-30T13-09-31-933Z/000-profile-document.html'];
  const path = docs.find(existsSync);
  if (!path) return t.skip('profile document capture missing');
  const c = topcardCounts(readFileSync(path, 'utf8'));

  // "500+" is a FLOOR, not an exact count — the literal is preserved so a consumer is not
  // misled into treating 500 as precise.
  assert.equal(c.connectionsText, '500+');
  assert.equal(c.connections, 500);
  // This member displays no follower count; null must mean "not shown", never 0.
  assert.equal(c.followers, null);
});

test('topcard: garbage input degrades to nulls rather than throwing', () => {
  const c = topcardCounts('<html><body>not a linkedin page</body></html>');
  assert.deepEqual(c, { connections: null, connectionsText: null, followers: null, followersText: null });
});

/* ---------------------------------- normalizedProfiles (shapes INFERRED, not verified) */
import { parseNormalized, PROVENANCE } from '../src/normalized.js';

test('normalized: tolerates every plausible shape without inventing values', () => {
  // Field NAMES are from a real 200; SHAPES are guesses. A wrong guess must yield null.
  assert.equal(parseNormalized({}).followers, null);
  assert.equal(parseNormalized({ data: null }).connectionDegree, null);
  assert.equal(parseNormalized({ data: { distance: 42, followingInfo: 'nope' } }).followers, null);

  const inlined = parseNormalized({ data: {
    distance: 'DISTANCE_2', followingInfo: { followerCount: 1234 },
    confirmedEmailAddresses: ['a@b.com'] } });
  assert.equal(inlined.connectionDegree, '2nd');
  assert.equal(inlined.followers, 1234);
  assert.equal(inlined.email, 'a@b.com');

  const referenced = parseNormalized({
    data: { distance: 'OUT_OF_NETWORK', '*followingInfo': 'urn:x' },
    included: [{ entityUrn: 'urn:x', followerCount: 99 }] });
  assert.equal(referenced.connectionDegree, '3rd+');
  assert.equal(referenced.followers, 99);
});

test('normalized: a missing badge is null, never false', () => {
  // "not shown" and "no badge" are different answers and must not collapse.
  assert.equal(parseNormalized({ data: {} }).isOpenToWork, null);
  assert.equal(parseNormalized({ data: { badges: { jobSeeker: false } } }).isOpenToWork, false);
  assert.equal(parseNormalized({ data: { badges: { jobSeeker: true } } }).isOpenToWork, true);
});

test('normalized: parses the live response correctly', (t) => {
  const p = 'captures/live-social-complete-at-cap.json';
  if (!existsSync(p)) return t.skip('no live social capture');
  const d = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(d.ok, true);
  assert.equal(d.meta.upstreamRequests, 2, 'profile + normalizedProfiles');
  // Confirms the previously-inferred enum mapping against a real value.
  assert.equal(d.profile.memberDistance, 'DISTANCE_3');
  assert.equal(d.profile.connectionDegree, '3rd');
  assert.equal(typeof d.profile.followers, 'number');
  assert.ok(d.profile.followers > 0);
  // Badges must be real booleans, not nulls, once the source is reachable.
  for (const k of ['isOpenToWork', 'isHiring', 'isInfluencer', 'isPremium']) {
    assert.equal(typeof d.profile[k], 'boolean', `${k} should be boolean`);
  }
  // Contact fields stay absent for a non-connection -- expected, not a failure.
  assert.equal(d.profile.email ?? null, null);
});

test('normalized: provenance reflects what was actually verified', () => {
  assert.ok(PROVENANCE.verified.includes('followers'));
  assert.ok(PROVENANCE.verified.includes('connectionDegree'));
  // email/phone were never observed populated, so they must NOT claim verified.
  assert.ok(PROVENANCE.inferred.includes('email'));
  assert.ok(!PROVENANCE.verified.includes('email'));
});
