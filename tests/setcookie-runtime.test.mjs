// Runtime check for Set-Cookie harvesting. The failure this guards against is silent: a naive
// headers.get('set-cookie') FOLDS several Set-Cookie headers into one comma-joined string, which
// would corrupt the jar on every refresh rather than error. Verified 2026-08-31 to split
// correctly in both Node (v26) and workerd via a loopback origin. NO external network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mergeCookies } from '../src/session.mjs';

const SET = [
  'li_at=REFRESHED_VALUE; Path=/; HttpOnly; Secure',
  '__cf_bm=NEWTOKEN-1788140000-1.0; Path=/; Max-Age=1800',
  'lidc="b=VB86:t=1788204216"; Path=/',
];

const withOrigin = async (fn) => {
  const srv = createServer((req, res) => {
    res.setHeader('Set-Cookie', SET);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/`); }
  finally { srv.close(); }
};

test('runtime: getSetCookie() splits headers that .get() would fold', async () => {
  await withOrigin(async (url) => {
    const r = await fetch(url);
    assert.equal(typeof r.headers.getSetCookie, 'function', 'runtime lacks getSetCookie');
    assert.equal(r.headers.getSetCookie().length, 3, 'headers were folded — jar would corrupt');
    // prove the naive path really is lossy, so nobody "simplifies" it back
    assert.ok(!Array.isArray(r.headers.get('set-cookie')));
  });
});

test('runtime: a live response refreshes li_at and keeps durable cookies', async () => {
  await withOrigin(async (url) => {
    const r = await fetch(url);
    const m = mergeCookies('li_at=STALE; JSESSIONID="ajax:9"; bcookie=b', r.headers.getSetCookie());
    assert.match(m.jar, /li_at=REFRESHED_VALUE/);
    assert.match(m.jar, /JSESSIONID="ajax:9"/);
    assert.match(m.jar, /bcookie=b/);
    assert.deepEqual(m.updated, ['li_at']);
    assert.deepEqual(m.added, ['__cf_bm', 'lidc']);
    assert.equal(m.sessionKilled, false);
  });
});

test('runtime: a 302 + `li_at=delete me` is caught as session death', async () => {
  const srv = createServer((req, res) => {
    res.setHeader('Set-Cookie', ['li_at=delete me; Path=/; Max-Age=0']);
    res.writeHead(302, { location: 'https://www.linkedin.com/uas/login' });
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const m = mergeCookies('li_at=A; bcookie=b', r.headers.getSetCookie());
    assert.equal(m.sessionKilled, true);
    assert.deepEqual(m.removed, ['li_at']);
    assert.doesNotMatch(m.jar, /li_at/);
  } finally { srv.close(); }
});
