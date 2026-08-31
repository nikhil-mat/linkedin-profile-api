// UPSTREAM_DISABLED: a hard stop below the routes. Added 2026-08-31 after an unauthorised
// request fired while testing a safeguard meant to prevent exactly that.
//
// These tests assert the guard REFUSES; they never let a real fetch happen. NO network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { upstreamDisabled, assertUpstreamAllowed, UpstreamDisabledError } from '../src/session.mjs';
import { fetchProfile, fetchSection, fetchDocument, fetchNormalized, fetchCompany } from '../api/src/transport.js';

const CREDS = { liAt: 'x', jsession: 'ajax:1', ua: 'macos' };
const ARMED = { UPSTREAM_DISABLED: 'true' };

test('killswitch: truthy spellings arm it, everything else does not', () => {
  for (const v of ['true', 'TRUE', '1', 'yes', 'on', 'On']) {
    assert.equal(upstreamDisabled({ UPSTREAM_DISABLED: v }), true, `${v} should arm`);
  }
  for (const v of ['false', '0', 'no', '', undefined, null]) {
    assert.equal(upstreamDisabled({ UPSTREAM_DISABLED: v }), false, `${v} should not arm`);
  }
  assert.equal(upstreamDisabled({}), false);
  assert.equal(upstreamDisabled(undefined), false);
});

test('killswitch: assert throws with the blocked url attached', () => {
  assert.throws(() => assertUpstreamAllowed(ARMED, 'https://www.linkedin.com/voyager/x'),
    (e) => e instanceof UpstreamDisabledError && e.blockedUrl.includes('voyager'));
  assert.doesNotThrow(() => assertUpstreamAllowed({}, 'https://www.linkedin.com/'));
});

// The point of the chokepoint: EVERY upstream entrypoint refuses, including the ones added
// later and the relay path (which reaches LinkedIn via a third party, so it counts too).
for (const [name, call] of [
  ['fetchProfile',    (env) => fetchProfile(env, CREDS, 'someone')],
  ['fetchSection',    (env) => fetchSection(env, CREDS, 'ACoAA', 'SKILLS')],
  ['fetchDocument',   (env) => fetchDocument(env, CREDS, 'someone')],
  ['fetchNormalized', (env) => fetchNormalized(env, CREDS, 'ACoAA')],
  ['fetchCompany',    (env) => fetchCompany(env, CREDS, 'ontross')],
]) {
  test(`killswitch: ${name} refuses when armed (direct egress)`, async () => {
    await assert.rejects(() => call({ ...ARMED }), UpstreamDisabledError);
  });
  test(`killswitch: ${name} refuses when armed (relay egress)`, async () => {
    await assert.rejects(
      () => call({ ...ARMED, RELAY_URL: 'https://relay.example', RELAY_SECRET: 's' }),
      UpstreamDisabledError);
  });
}

test('killswitch: no raw fetch( survives in the transport', () => {
  // guards against a future edit reintroducing an unguarded call site
  const src = readFileSync('api/src/transport.js', 'utf8');
  const raw = src.split('\n').filter((l) => /(?<!guarded)\bfetch\(/.test(l) && !l.includes('guardedFetch(env'));
  assert.deepEqual(raw.filter((l) => !l.trim().startsWith('//') && !l.includes('return fetch(url, init)')), []);
});

test('killswitch: the local config sets it EXPLICITLY, either way', (t) => {
  // Deliberately not asserting `=true`: disarming to make a real request is a legitimate state,
  // and a suite that goes red during normal operation trains you to ignore it. What must never
  // happen is the key going MISSING, which would silently restore the old always-on behaviour.
  for (const f of ['.env', 'api/.dev.vars']) {
    const txt = existsSync(f) ? readFileSync(f, 'utf8') : null;
    if (txt === null) { t.diagnostic(`${f} absent — fresh clone`); continue; }
    // values are single-quoted so the file stays shell-sourceable; accept quoted or bare
    assert.match(txt, /^UPSTREAM_DISABLED=['"]?(true|false)['"]?$/m,
      `${f} must set UPSTREAM_DISABLED explicitly`);
    if (!/^UPSTREAM_DISABLED=['"]?true['"]?$/m.test(txt)) {
      t.diagnostic(`${f}: DISARMED — live requests are possible`);
    }
  }
});
