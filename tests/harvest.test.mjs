// x-li-page-instance generation + Set-Cookie harvesting. Both derived from the 2026-08-31 HAR
// (46 live voyager calls) and the refs on cookie re-affirmation. NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageInstance, PAGE_KEYS, parseSetCookie, mergeCookies, upstreamHeaders }
  from '../src/session.mjs';

const CREDS = { liAt: 'x', jsession: 'ajax:1', ua: 'macos' };

/* ---------------------------------------------------------- page-instance */
test('page-instance: matches the captured format exactly', () => {
  // observed: urn:li:page:d_flagship3_profile_view_base;oSuMuQbBQzi+RwLN7087Fw==
  assert.match(pageInstance(), /^urn:li:page:d_flagship3_profile_view_base;[A-Za-z0-9+/]{22}==$/);
});

test('page-instance: the id is 16 random bytes, fresh every call', () => {
  const ids = new Set(Array.from({ length: 200 }, () => pageInstance().split(';')[1]));
  assert.equal(ids.size, 200, 'ids must not repeat');
  for (const id of ids) assert.equal(atob(id).length, 16);
});

test('page-instance: pageKey is selectable and profile is the default', () => {
  assert.ok(pageInstance(PAGE_KEYS.company).startsWith('urn:li:page:d_flagship3_company;'));
  assert.ok(pageInstance().startsWith(`urn:li:page:${PAGE_KEYS.profile};`));
});

test('page-instance: it is actually sent, and never repeats between requests', () => {
  const a = upstreamHeaders(CREDS)['x-li-page-instance'];
  const b = upstreamHeaders(CREDS)['x-li-page-instance'];
  assert.ok(a && b);
  assert.notEqual(a, b, 'pinning one value is the anomaly we are avoiding');
});

/* ------------------------------------------------------------ Set-Cookie */
test('parse: name/value split survives values containing "="', () => {
  const [c] = parseSetCookie(['lidc="b=OB1:s=V:t=123"; Path=/; HttpOnly']);
  assert.equal(c.name, 'lidc');
  assert.equal(c.value, '"b=OB1:s=V:t=123"');
  assert.equal(c.deleting, false);
});

test('parse: deletion is signalled three different ways', () => {
  const cs = parseSetCookie([
    'li_at=delete me; Path=/',                       // LinkedIn's literal kill value
    'foo=x; Max-Age=0',
    'bar=y; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'keep=z; Max-Age=3600',
  ]);
  assert.deepEqual(cs.map((c) => c.deleting), [true, true, true, false]);
});

test('merge: a refreshed li_at replaces the stored one', () => {
  const m = mergeCookies('li_at=OLD; bcookie=b', ['li_at=NEW; Path=/; HttpOnly']);
  assert.match(m.jar, /li_at=NEW/);
  assert.deepEqual(m.updated, ['li_at']);
  assert.equal(m.sessionKilled, false);
});

test('merge: new cookies are appended, existing order preserved', () => {
  const m = mergeCookies('li_at=A; bcookie=b', ['__cf_bm=tok; Max-Age=1800']);
  assert.deepEqual(m.added, ['__cf_bm']);
  assert.equal(m.jar, 'li_at=A; bcookie=b; __cf_bm=tok');
});

test('merge: `li_at=delete me` is the session-death signal, and drops the cookie', () => {
  const m = mergeCookies('li_at=A; bcookie=b', ['li_at=delete me; Max-Age=0']);
  assert.equal(m.sessionKilled, true);
  assert.deepEqual(m.removed, ['li_at']);
  assert.doesNotMatch(m.jar, /li_at/);
});

test('merge: a deleted NON-session cookie does not raise the kill flag', () => {
  const m = mergeCookies('li_at=A; junk=j', ['junk=; Max-Age=0']);
  assert.equal(m.sessionKilled, false);
  assert.deepEqual(m.removed, ['junk']);
  assert.match(m.jar, /li_at=A/);
});

test('merge: no Set-Cookie leaves the jar byte-identical', () => {
  const jar = 'li_at=A; JSESSIONID="ajax:9"; bcookie=b';
  assert.equal(mergeCookies(jar, []).jar, jar);
});

test('merge: stamps a new capture time so pruning re-bases off the refresh', () => {
  const m = mergeCookies('li_at=A', ['__cf_bm=tok']);
  assert.ok(Date.now() - Date.parse(m.capturedAt) < 5000);
});
