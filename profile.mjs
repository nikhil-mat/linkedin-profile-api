// profile URL or handle -> normalised profile JSON, in ONE request.
//
// Architecture: docs/08-SYNTHESIS.md. The browser is never in the request path -- it is
// needed only to mint the two cookies in .env. Supersedes the React Flight decoding and
// the 12-call ProfileComponents fan-out; both produced the same data for 13x the traffic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadAuth, headers } from './src/li-http.mjs';
import { parseProfile } from './src/profile-graph.mjs';

const DECORATION = process.env.LINKEDIN_PROFILE_DECORATION
  || 'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101';

const handle = (process.argv[2] || '').replace(/^.*\/in\//, '').replace(/\/.*$/, '');
if (!/^[\w-]+$/.test(handle)) throw new Error('usage: node profile.mjs <profile-url-or-handle>');

// Classify before parsing. A 410/999/302 fed to a parser reports an empty profile, which
// is indistinguishable from a real one -- the failure mode this whole design avoids.
//
// Taxonomy from refs/linkedin-internal-api/docs/SESSION-AND-ERRORS-DESIGN.md §2. The rule that
// matters: exactly ONE signal proves the session is dead -- a 302 to the login wall. Everything
// else must NOT set sessionDead, because "re-login" is then the wrong remedy and the reflex that
// sends people chasing fingerprinting ghosts. A 403 in particular is a csrf-header defect, and on
// this endpoint it may instead mean that one profile is restricted (Q-PROFILE-403-PER-PROFILE) --
// two very different causes that must not be collapsed into one confident message.
function classify(status, location) {
  if (status === 200) return null;
  if (status >= 300 && status < 400 && /\/uas\/login|\/login/.test(location ?? '')) {
    return ['SESSION_EXPIRED', 'cookies are stale -- log in again and re-extract li_at + JSESSIONID', true];
  }
  if (status === 403) {
    return ['FORBIDDEN', 'either the csrf-token header is malformed (it must be JSESSIONID with quotes stripped, ajax: prefix kept) or this specific profile is restricted. Probe /voyager/api/me: a 200 there means the session is fine and the profile is the problem. Treat 5+ consecutive 403s as a session issue.', false];
  }
  if (status === 401) return ['UNAUTHORIZED', 'cause not established by any reference; probe /voyager/api/me before assuming session death', false];
  if (status === 429) return ['RATE_LIMITED', 'stop and wait -- do NOT retry; retrying is how a warning becomes a restriction', false];
  if (status === 999) return ['REQUEST_DENIED', 'network-layer bot block; stop generating traffic for several hours', false];
  if (status === 410) return ['GONE', 'endpoint retired -- re-capture the decoration id', false];
  if (status === 400) return ['SCHEMA_DRIFT', 'decoration id likely rotated, or memberIdentity was passed a full urn: (it accepts only the bare id or the public slug)', false];
  if (status === 404) return ['NOT_FOUND', 'no such profile, or a rotated queryId/decoration', false];
  // An unrecognised failure is never session death.
  return ['ERROR', `unexpected HTTP ${status}`, false];
}

const url = 'https://www.linkedin.com/voyager/api/identity/dash/profiles'
  + `?q=memberIdentity&memberIdentity=${encodeURIComponent(handle)}`
  + `&decorationId=${DECORATION}`;

const res = await fetch(url, { headers: headers(loadAuth()), redirect: 'manual' });
const bad = classify(res.status, res.headers.get('location'));
if (bad) {
  console.error(`${bad[0]}: ${bad[1]}`);
  console.error(`sessionDead=${bad[2]}`);
  process.exit(1);
}
// Voyager answers with application/vnd.linkedin.normalized+json+2.1 -- a naive
// `includes('application/json')` check rejects every successful response.
const ctype = res.headers.get('content-type') ?? '';
if (!/\+json|application\/json/.test(ctype)) {
  console.error(`SCHEMA_DRIFT: expected a normalized+json response, got "${ctype}"`);
  process.exit(1);
}
const body = await res.text();

const OUT = `captures/profile-${handle}`; mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/raw.json`, body);

const { profile, meta } = parseProfile(JSON.parse(body));
writeFileSync(`${OUT}/profile.json`, JSON.stringify(profile, null, 2));

console.log(JSON.stringify(profile, null, 2));
const counts = ['experience','education','skills','certifications','languages','courses','projects',
  'honors','publications','patents','organizations','volunteering','testScores']
  .map(k => `${k}=${profile[k].length}`).filter(s => !s.endsWith('=0')).join(' ');
console.error(`\n1 request | ${meta.includedCount} records | ${counts}`);
console.error(`state=${meta.state}`);
if (meta.truncated.length) console.error(`TRUNCATED -- server capped these, more exist: ${meta.truncated.join(', ')}`);
if (meta.unresolved.length) console.error(`UNRESOLVED -- failed decoration, records missing under the cap: ${meta.unresolved.join(', ')}`);
if (meta.unknownTypes.length) console.error(`unknown types: ${JSON.stringify(meta.unknownTypes)}`);
console.error(`written: ${OUT}/profile.json`);
