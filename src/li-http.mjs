// Browserless Voyager transport for LOCAL scripts. Reads cookies from .env; never prints them.
// Per refs/linkedin-internal-api/docs/01-AUTH-AND-COOKIES.md: only li_at + JSESSIONID are needed
// for the call to SUCCEED, csrf-token = JSESSIONID with surrounding quotes stripped.
//
// Header construction lives in src/session.mjs so this and the Worker cannot drift apart again.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeSession, upstreamHeaders, profileReferer, UA_PRESETS,
         assertUpstreamAllowed, mergeCookies } from './session.mjs';

export { UA_PRESETS, profileReferer };

// Strip a wrapping quote ONLY when it is a wrapper. Two traps live here:
//   - `sec-ch-ua` legitimately STARTS and ENDS with `"` ("Chromium";v="152", … ,"Brave";v="152").
//     Blind stripping silently corrupted it.
//   - Values are written single-quoted so the files stay `. ./.env`-sourceable, and POSIX escapes
//     an inner single quote as '\'' -- which must be un-escaped, not treated as a non-wrapper.
export function unquote(v) {
  if (v.length > 1 && v[0] === "'" && v.at(-1) === "'") {
    return v.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (v.length > 1 && v[0] === '"' && v.at(-1) === '"' && !v.slice(1, -1).includes('"')) {
    return v.slice(1, -1);
  }
  return v;
}

export function readEnv(envPath = new URL('../.env', import.meta.url)) {
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = unquote(m[2].trim());
  }
  return env;
}

export function loadAuth(envPath = new URL('../.env', import.meta.url)) {
  const env = readEnv(envPath);
  const liAt = env.LINKEDIN_LI_AT, jsession = env.LINKEDIN_JSESSIONID;
  if (!liAt || !jsession) throw new Error('missing LINKEDIN_LI_AT / LINKEDIN_JSESSIONID in .env');
  // Throws when LINKEDIN_USER_AGENT is absent -- there is deliberately no default.
  return makeSession({
    liAt, jsession,
    ua: env.LINKEDIN_USER_AGENT,
    cookies: env.LINKEDIN_COOKIES,
    secChUa: env.LINKEDIN_SEC_CH_UA,
    acceptLanguage: env.LINKEDIN_ACCEPT_LANGUAGE,
    xLiTrack: env.LINKEDIN_X_LI_TRACK,
    extraHeaders: env.LINKEDIN_EXTRA_HEADERS,
    capturedAt: env.LINKEDIN_SESSION_CAPTURED_AT,
  });
}

// WHY THE UA MATTERS -- stated at its real confidence level, because this file previously
// asserted it as documented fact and refs/ does not say it.
//   DOCUMENTED: UA *staleness* is a challenge trigger -- a CHALLENGE cleared by bumping a
//     hardcoded Chrome 83 string to current (refs/linkedin-relay/docs/research/
//     R3-linkedin-surface.md:214, [reported: GitHub issue]).
//   DOCUMENTED: the browser-driving repos say do NOT hand-build a fingerprint at all
//     (refs/linkedin-mcp/src/browser/engine.ts:15, session_browser.py:52).
//   OUR INFERENCE, NOT IN refs/: that an OS mismatch between the UA and the device that minted
//     li_at contributes to invalidation. Consistent with docs/OPERATIONS.md incident 3 (session
//     invalidated after one call from a different origin) and with the 2026-08-31 logout, but
//     that is n=2 on different variables -- a hypothesis, not a finding.

export function headers(auth, extra, opts) {
  return { ...upstreamHeaders(auth, opts), ...extra };
}

// A 302 to /uas/login means the cookies are stale — not bot detection (docs/01 §pitfall).
export async function vget(url, auth = loadAuth(), extra) {
  const _env = readEnv();
  assertUpstreamAllowed(_env, url);   // armed by UPSTREAM_DISABLED in .env
  const r = await fetch(url, { headers: headers(auth, extra), redirect: 'manual' });
  const body = await r.text();
  const harvest = absorb(_env, r.headers.getSetCookie?.() ?? [], envPathOf());
  if (r.status === 302 || r.status === 303) {
    throw new Error(`session expired (${r.status} -> login); re-extract cookies into .env`);
  }
  if (harvest?.sessionKilled) {
    throw new Error('session killed: LinkedIn sent `set-cookie: li_at=delete me` — re-login required');
  }
  return { status: r.status, body, cookiesRefreshed: harvest?.refreshed ?? [] };
}

const envPathOf = () => new URL('../.env', import.meta.url);

// Absorb what the server sent. Writing back is OPT-IN (LINKEDIN_PERSIST_COOKIES=true): silently
// rewriting a credentials file as a side effect of a GET is the kind of surprise this project
// has been bitten by. Without the flag we still report what changed.
export function absorb(env, setCookieList, envPath) {
  if (!setCookieList?.length) return null;
  const m = mergeCookies(env.LINKEDIN_COOKIES ?? '', setCookieList);
  const refreshed = [...m.updated, ...m.added];
  if (m.sessionKilled) return { ...m, refreshed };
  if (String(env.LINKEDIN_PERSIST_COOKIES) !== 'true' || !refreshed.length) return { ...m, refreshed };

  const text = readFileSync(envPath, 'utf8');
  const enc = (v) => (v.includes('"') ? `'${v}'` : v);
  let out = text
    .replace(/^LINKEDIN_COOKIES=.*$/m, `LINKEDIN_COOKIES=${enc(m.jar)}`)
    .replace(/^LINKEDIN_SESSION_CAPTURED_AT=.*$/m, `LINKEDIN_SESSION_CAPTURED_AT=${m.capturedAt}`);
  const liAt = /(?:^|; )li_at=([^;]+)/.exec(m.jar)?.[1];
  if (liAt) out = out.replace(/^LINKEDIN_LI_AT=.*$/m, `LINKEDIN_LI_AT=${liAt}`);
  writeFileSync(envPath, out, { mode: 0o600 });
  return { ...m, refreshed, persisted: true };
}
