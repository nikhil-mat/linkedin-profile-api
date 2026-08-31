// Perishable-cookie pruning. Replaces an earlier suite that asserted the transport REFUSES a
// bundle older than 25 min -- that was wrong: refs/linkedin-toolkit/README.md:104 measures
// li_at at ~12 months and JSESSIONID at ~30 days, so age is not a reason to refuse a request.
// Only __cf_bm (~30 min) and lidc (embedded expiry) go stale, and those get dropped. NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneCookies, upstreamHeaders, sessionAgeMin, CF_BM_TTL_MIN } from '../src/session.mjs';
import { fetchProfile } from '../api/src/transport.js';

const CREDS = { liAt: 'x', jsession: 'ajax:1', ua: 'macos' };
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const JAR = 'bcookie="v=2&a"; li_at=AQEDx; JSESSIONID="ajax:9"; lidc="b=OB1:t=4102444800"; __cf_bm=tok-1788136811.2-1.0';

test('prune: a fresh __cf_bm is kept', () => {
  const { jar, dropped } = pruneCookies(JAR, iso(5));
  assert.deepEqual(dropped, []);
  assert.match(jar, /__cf_bm=/);
});

test('prune: a stale __cf_bm is dropped, everything durable survives', () => {
  const { jar, dropped } = pruneCookies(JAR, iso(CF_BM_TTL_MIN + 5));
  assert.deepEqual(dropped, ['__cf_bm']);
  assert.doesNotMatch(jar, /__cf_bm=/);
  for (const keep of ['li_at=', 'JSESSIONID=', 'bcookie=']) assert.match(jar, new RegExp(keep));
});

test('prune: unknown capture time treats __cf_bm as expired, never as fresh', () => {
  // guessing "probably still good" is how a stale token goes out
  assert.deepEqual(pruneCookies(JAR, null).dropped, ['__cf_bm']);
  assert.deepEqual(pruneCookies(JAR, 'garbage').dropped, ['__cf_bm']);
});

test('prune: lidc is dropped only once its embedded t= has passed', () => {
  const expired = JAR.replace('t=4102444800', 't=1000000000');
  assert.ok(pruneCookies(expired, iso(1)).dropped.includes('lidc'));
  assert.ok(!pruneCookies(JAR, iso(1)).dropped.includes('lidc'));   // t= is far future
});

test('prune: li_at and JSESSIONID are NEVER dropped for age', () => {
  // ~12 months and ~30 days respectively -- a 2-day-old bundle is still perfectly usable
  const { jar, dropped } = pruneCookies(JAR, iso(60 * 24 * 2));
  assert.match(jar, /li_at=AQEDx/);
  assert.match(jar, /JSESSIONID="ajax:9"/);
  assert.deepEqual(dropped, ['__cf_bm']);
});

test('headers: pruning is applied during construction', () => {
  const withJar = { ...CREDS, cookies: JAR };
  assert.match(upstreamHeaders(withJar, { capturedAt: iso(2) }).cookie, /__cf_bm=/);
  assert.doesNotMatch(upstreamHeaders(withJar, { capturedAt: iso(90) }).cookie, /__cf_bm=/);
});

test('headers: referer is the preload URL the real client sends (n=47, two accounts)', () => {
  assert.equal(upstreamHeaders(CREDS).referer, 'https://www.linkedin.com/preload/?_bprMode=vanilla');
});

test('transport: an OLD bundle is no longer refused — only the kill switch refuses', async () => {
  await assert.rejects(
    () => fetchProfile({ UPSTREAM_DISABLED: 'true', LINKEDIN_SESSION_CAPTURED_AT: iso(9999) }, CREDS, 'x'),
    { name: 'UpstreamDisabledError' });   // and nothing else would have stopped it
});

test('age is still reported, just not enforced', () => {
  assert.equal(Math.round(sessionAgeMin({ LINKEDIN_SESSION_CAPTURED_AT: iso(45) })), 45);
  assert.equal(sessionAgeMin({}), null);
});
