// Session identity + header construction. Pins the 2026-08-31 incident: a defaulted Windows UA
// went out on a macOS-minted cookie for every live request, and the two transports had drifted
// into different header sets. NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, upstreamHeaders, resolveUa, platformOf, UA_PRESETS,
         MissingUserAgentError, profileReferer } from '../src/session.mjs';
import { upstreamHeaders as workerHeaders } from '../api/src/transport.js';
import { headers as localHeaders } from '../src/li-http.mjs';

const CREDS = { liAt: 'AQEDtest', jsession: '"ajax:1234567890"', ua: 'macos' };

test('session: a missing UA throws instead of defaulting', () => {
  assert.throws(() => resolveUa(undefined), MissingUserAgentError);
  assert.throws(() => resolveUa(''), MissingUserAgentError);
  assert.throws(() => resolveUa('   '), MissingUserAgentError);
  // the whole point: no silent fallback to a wrong-OS preset
  assert.throws(() => makeSession({ liAt: 'x', jsession: 'ajax:1' }), MissingUserAgentError);
});

test('session: presets resolve, and an explicit UA string passes through verbatim', () => {
  assert.equal(resolveUa('macos'), UA_PRESETS.macos);
  assert.equal(resolveUa('MacOS'), UA_PRESETS.macos);
  const custom = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/151.0.0.0';
  assert.equal(resolveUa(custom), custom);
});

test('session: csrf strips quotes and keeps the ajax: prefix', () => {
  const s = makeSession(CREDS);
  assert.equal(s.csrf, 'ajax:1234567890');
  const h = upstreamHeaders(s);
  assert.equal(h['csrf-token'], 'ajax:1234567890');
  // the cookie re-quotes it; the header does not. Getting this backwards is a documented trap.
  assert.match(h.cookie, /JSESSIONID="ajax:1234567890"/);
});

test('session: sec-ch-ua-platform can never disagree with the user-agent', () => {
  for (const [preset, expected] of [['macos', '"macOS"'], ['windows', '"Windows"']]) {
    const h = upstreamHeaders({ ...CREDS, ua: preset });
    assert.equal(h['sec-ch-ua-platform'], expected);
    assert.equal(platformOf(h['user-agent']), expected, `${preset} UA/platform mismatch`);
  }
});

test('session: sec-ch-ua is omitted unless supplied (GREASE cannot be derived)', () => {
  assert.equal('sec-ch-ua' in upstreamHeaders(CREDS), false);
  const h = upstreamHeaders({ ...CREDS, secChUa: '"Chromium";v="152"' });
  assert.equal(h['sec-ch-ua'], '"Chromium";v="152"');
});

test('session: a verbatim cookie jar wins over the two-cookie reconstruction', () => {
  const jar = 'bcookie="v=2&abc"; li_at=AQEDreal; JSESSIONID="ajax:9"; lidc="b=OB1"';
  assert.equal(upstreamHeaders({ ...CREDS, cookies: jar }).cookie, jar);
  // a jar without li_at is a paste error, not a valid session
  assert.throws(() => makeSession({ ...CREDS, cookies: 'bcookie=x; lidc=y' }), /no li_at/);
});

test('session: referer is the profile page, not a constant /feed/', () => {
  const h = upstreamHeaders(CREDS, { referer: profileReferer('complete-at-cap') });
  assert.equal(h.referer, 'https://www.linkedin.com/in/complete-at-cap/');
});

test('session: the XHR fetch-metadata headers are present and same-origin', () => {
  const h = upstreamHeaders(CREDS);
  assert.equal(h['sec-fetch-site'], 'same-origin');
  assert.equal(h['sec-fetch-mode'], 'cors');
  assert.equal(h['sec-fetch-dest'], 'empty');
  assert.equal(h['priority'], 'u=1, i');
  assert.equal(h['accept'], 'application/vnd.linkedin.normalized+json+2.1');
});

test('session: no `origin` header — the real client omits it on this same-origin GET', () => {
  // Adding a header the browser does not send is the same invention error as guessing the UA.
  // Verified against a captured Voyager request 2026-08-31.
  assert.equal('origin' in upstreamHeaders(CREDS), false);
});

test('session: accept-language is copied, not assumed', () => {
  // Brave sends q=0.7, not the q=0.9 that was hardcoded here before.
  assert.equal(upstreamHeaders(CREDS)['accept-language'], 'en-US,en;q=0.9');   // default
  assert.equal(upstreamHeaders({ ...CREDS, acceptLanguage: 'en-US,en;q=0.7' })['accept-language'],
               'en-US,en;q=0.7');
});

test('session: extraHeaders are merged verbatim and accept a JSON string', () => {
  assert.equal(upstreamHeaders({ ...CREDS, extraHeaders: { 'sec-gpc': '1' } })['sec-gpc'], '1');
  assert.equal(upstreamHeaders({ ...CREDS, extraHeaders: '{"sec-gpc":"1"}' })['sec-gpc'], '1');
});

test('session: x-li-page-instance is GENERATED per request, never pinned', () => {
  // Superseded 2026-08-31: the HAR shows it on 100% of 46 live voyager calls, so omitting it was
  // wrong. Pinning a captured value would still be wrong -- the id is per page-view.
  const a = upstreamHeaders(CREDS)['x-li-page-instance'];
  assert.match(a, /^urn:li:page:[a-z0-9_]+;[A-Za-z0-9+/]{22}==$/);
  assert.notEqual(a, upstreamHeaders(CREDS)['x-li-page-instance']);
});

test('session: the Worker and the local script emit IDENTICAL headers', () => {
  // This is the regression that matters: they were two hand-maintained copies and had already
  // diverged (the Worker was missing `referer` entirely).
  const opts = { referer: profileReferer('someone') };
  // x-li-page-instance is deliberately random per call, so compare everything else and assert
  // both emit it. Comparing it directly would only ever prove the RNG works.
  const RANDOM = 'x-li-page-instance';
  const strip = (h) => { const { [RANDOM]: r, ...rest } = h; assert.ok(r, 'must emit ' + RANDOM); return rest; };
  assert.deepEqual(strip(workerHeaders(CREDS, opts)), strip(upstreamHeaders(CREDS, opts)));
  assert.deepEqual(strip(localHeaders(makeSession(CREDS), undefined, opts)), strip(upstreamHeaders(CREDS, opts)));
});

test('session: .env unquoting never corrupts a value that legitimately starts with a quote', async () => {
  const { unquote } = await import('../src/li-http.mjs');
  const secCh = '"Chromium";v="152", "Not?A_Brand";v="24", "Brave";v="152"';
  assert.equal(unquote(secCh), secCh, 'sec-ch-ua must survive intact');
  assert.equal(unquote('"ajax:123"'), 'ajax:123', 'a true wrapper is still stripped');
  assert.equal(unquote("'{\"sec-gpc\":\"1\"}'"), '{"sec-gpc":"1"}', 'single-quoted JSON unwraps');
  assert.equal(unquote('plain'), 'plain');
});

test('session: .env values are shell-safe AND parse back byte-identically', async () => {
  // On 2026-08-31 `. ./.env` failed with "parse error near '('" -- the unquoted User-Agent
  // contains parens and accept-language contains a semicolon. The danger is not the error: it is
  // that sourcing aborts PART WAY, leaving some vars set and others empty. Silent, not loud.
  const { unquote } = await import('../src/li-http.mjs');
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const enc = (v) => `'${v.replace(/'/g, "'\\''")}'`;
  const cases = {
    UA:   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
    LANG: 'en-US,en;q=0.7',
    CH:   '"Chromium";v="152", "Not?A_Brand";v="24", "Brave";v="152"',
    JAR:  'bcookie="v=2&a"; li_at=AQ; JSESSIONID="ajax:9"; lidc="b=X:t=1"',
    JSON_: '{"clientVersion":"1.13.46267","timezone":"Asia/Calcutta"}',
    QUOTE: "value with ' a single quote",
  };
  const dir = mkdtempSync(join(tmpdir(), 'envtest-'));
  const file = join(dir, '.env');
  writeFileSync(file, Object.entries(cases).map(([k, v]) => `${k}=${enc(v)}`).join('\n') + '\n');

  // 1. a POSIX shell can source it without error
  for (const [k, expected] of Object.entries(cases)) {
    const got = execFileSync('sh', ['-c', `. ${file} && printf %s "$${k}"`], { encoding: 'utf8' });
    assert.equal(got, expected, `shell round-trip failed for ${k}`);
  }
  // 2. and our own reader recovers the same bytes
  for (const [k, expected] of Object.entries(cases)) {
    assert.equal(unquote(enc(expected)), expected, `unquote round-trip failed for ${k}`);
  }
});
