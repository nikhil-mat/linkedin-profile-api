// Single source of truth for SESSION IDENTITY and upstream header construction.
//
// This file deliberately has NO `node:` imports so the Worker and the local scripts share one
// implementation. Before this existed, src/li-http.mjs and api/src/transport.js each built their
// own header set and had already drifted: one sent `referer`, the other did not, and both
// defaulted the User-Agent to Windows. On 2026-08-31 that default sent a Windows UA on a
// macOS-minted cookie for every live request.
//
// THE RULE: copy, do not invent. Every value here should be lifted verbatim from the browser
// that minted `li_at`. Values we can DERIVE unambiguously from the UA are derived; values that
// cannot be derived (the GREASE brand in sec-ch-ua) are omitted unless supplied.

export const UA_PRESETS = {
  // Chrome freezes minor/build/patch to `0.0.0` (UA Reduction) and pins Windows to `NT 10.0`,
  // macOS to `10_15_7`, regardless of the real OS version -- these literals are correct, not
  // stale. Refresh the MAJOR version from github.com/jnrbsn/user-agents.
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  macos:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
};

export class MissingUserAgentError extends Error {
  constructor() {
    super('LINKEDIN_USER_AGENT is required and has no default. It must match the browser+OS '
        + 'that minted li_at -- a guessed default is what caused the 2026-08-31 incident. '
        + 'Use "macos", "windows", or paste the exact UA string.');
    this.name = 'MissingUserAgentError';
  }
}

// No fallback, by design. A silently-wrong UA is worse than a loud failure: it still reaches
// LinkedIn, it just reaches it incoherently. Same reasoning as the bound-credential opt-in.
export function resolveUa(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new MissingUserAgentError();
  return UA_PRESETS[s.toLowerCase()] ?? s;
}

// Derivable from the UA string with no guessing, so it can never disagree with it.
export function platformOf(ua) {
  if (/Macintosh|Mac OS X/.test(ua)) return '"macOS"';
  if (/Windows/.test(ua)) return '"Windows"';
  if (/Linux|X11/.test(ua)) return '"Linux"';
  return null;
}

/**
 * Normalise a session bundle. `cookies` is the VERBATIM cookie jar from the browser; when
 * present it wins over the two-cookie reconstruction, because a real jar carries bcookie /
 * bscookie / lidc that we cannot synthesise.
 */
export function makeSession({ liAt, jsession, ua, cookies, acceptLanguage, secChUa, xLiTrack,
                             extraHeaders, capturedAt }) {
  const csrf = String(jsession ?? '').replace(/"/g, '');   // quotes stripped, ajax: prefix kept
  const agent = resolveUa(ua);
  if (cookies && !/\bli_at=/.test(cookies)) {
    throw new Error('LINKEDIN_COOKIES was supplied but contains no li_at');
  }
  return {
    liAt, csrf, ua: agent,
    cookies: cookies || null,
    acceptLanguage: acceptLanguage || 'en-US,en;q=0.9',
    secChUa: secChUa || null,       // GREASE brand cannot be derived -- supply it or omit it
    // Pins the deployed web client version, so it DRIFTS like the queryId hashes do. Copied
    // verbatim when supplied; omitted entirely rather than guessed.
    xLiTrack: xLiTrack || null,
    // Anything else the real browser sends that we cannot derive (sec-gpc reflects a user
    // privacy setting, not a universal). Copied verbatim from the captured request or omitted.
    capturedAt: capturedAt || null,
    extraHeaders: typeof extraHeaders === 'string'
      ? (extraHeaders.trim() ? JSON.parse(extraHeaders) : null)
      : (extraHeaders || null),
  };
}

/**
 * The full upstream header set. `referer` should be the page the XHR would fire from (the
 * profile page), not a constant -- the web client never requests profile data from /feed/.
 */
export function upstreamHeaders(session, { referer, capturedAt, now, pageKey } = {}) {
  const s = session.csrf !== undefined ? session : makeSession(session);
  const cookie = s.cookies
    ? pruneCookies(s.cookies, capturedAt ?? s.capturedAt, now).jar
    : `li_at=${s.liAt}; JSESSIONID="${s.csrf}"`;
  const platform = platformOf(s.ua);
  const h = {
    'cookie': cookie,
    'csrf-token': s.csrf,
    'x-restli-protocol-version': '2.0.0',
    'accept': 'application/vnd.linkedin.normalized+json+2.1',
    'accept-language': s.acceptLanguage,
    'user-agent': s.ua,
    'x-li-lang': 'en_US',
    // NO `origin`: the captured browser request does not send it on this same-origin GET, and
    // adding a header the real client omits is the same invention error as guessing the UA.
    // n=47 across two independent accounts: the real client sends the preload referer on EVERY
    // voyager XHR, including calls whose x-li-page-instance says profile_view. Reasoning that it
    // "should" be the profile page was wrong.
    'referer': referer || 'https://www.linkedin.com/preload/?_bprMode=vanilla',
    'priority': 'u=1, i',
    // A Voyager call is an XHR from a same-origin page; these three are deterministic.
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'sec-ch-ua-mobile': '?0',
  };
  if (platform) h['sec-ch-ua-platform'] = platform;
  if (s.secChUa) h['sec-ch-ua'] = s.secChUa;
  if (s.xLiTrack) h['x-li-track'] = s.xLiTrack;
  // Sent on 100% of the 46 captured voyager calls. GENERATED, never copied: the id is per
  // page-view, so replaying one fixed value forever is itself the anomaly.
  h['x-li-page-instance'] = pageInstance(pageKey);
  return s.extraHeaders ? { ...h, ...s.extraHeaders } : h;
}

export const profileReferer = (slug) => `https://www.linkedin.com/in/${slug}/`;

/* ------------------------------------------------------- the kill switch ---- */
// A hard stop that sits BELOW the routes, so no code path -- a new route, a test, a debug
// script, an enrichment -- can reach LinkedIn while it is armed. Added after 2026-08-31, when
// a request fired during a test of a safeguard that was supposed to prevent exactly that.
//
// Enforcement is at the single fetch chokepoint rather than at each entrypoint: guarding five
// functions means the sixth one someone adds is unguarded by default.

export class UpstreamDisabledError extends Error {
  constructor(url) {
    super('UPSTREAM_DISABLED is armed: refusing to contact LinkedIn. '
        + 'Unset it in .env / api/.dev.vars to allow live requests.'
        + (url ? ` (blocked: ${String(url).slice(0, 120)})` : ''));
    this.name = 'UpstreamDisabledError';
    this.blockedUrl = url ?? null;
  }
}

export const upstreamDisabled = (env) =>
  /^(true|1|yes|on)$/i.test(String(env?.UPSTREAM_DISABLED ?? ''));

export function assertUpstreamAllowed(env, url) {
  if (upstreamDisabled(env)) throw new UpstreamDisabledError(url);
}

/* ------------------------------------------------ perishable cookies -------- */
// CORRECTED 2026-08-31. An earlier version refused the whole bundle once it passed 25 minutes,
// which threw away a credential that refs/linkedin-toolkit/README.md:104 measures at
// ~12 MONTHS (`li_at` ~12mo, `JSESSIONID` ~30d). Only two cookies in the jar are short-lived:
//
//   __cf_bm  Cloudflare Bot Management, ~30 min. Cloudflare issues a fresh one on any response,
//            so a missing one costs nothing; a stale one is just wrong.
//   lidc     routing, with its own expiry embedded as `t=<unix>`.
//
// So we PRUNE the perishable entries and keep sending the durable ones. The session itself does
// not expire on a timer -- it dies on logout/security action, and LinkedIn signals that with a
// 302 plus `set-cookie: li_at=delete me` (refs/linkedin-cli/internal/api/client.go:76), which is
// an observation about a RESPONSE, not something a clock can predict.

export const CF_BM_TTL_MIN = 30;

export function pruneCookies(jar, capturedAtIso, now = Date.now()) {
  if (!jar) return { jar, dropped: [] };
  const dropped = [];
  const captured = capturedAtIso ? Date.parse(capturedAtIso) : NaN;
  const ageMin = Number.isNaN(captured) ? null : (now - captured) / 60000;

  const kept = jar.split(';').map((c) => c.trim()).filter((c) => {
    const name = c.split('=')[0];
    if (name === '__cf_bm' && (ageMin === null || ageMin > CF_BM_TTL_MIN)) {
      dropped.push('__cf_bm'); return false;              // unknown age counts as expired
    }
    if (name === 'lidc') {
      const t = Number((c.match(/[:"]t=(\d{10})/) || [])[1]);
      if (t && t * 1000 < now) { dropped.push('lidc'); return false; }
    }
    return true;
  });
  return { jar: kept.join('; '), dropped };
}

export function sessionAgeMin(env, now = Date.now()) {
  const t = Date.parse(env?.LINKEDIN_SESSION_CAPTURED_AT ?? '');
  return Number.isNaN(t) ? null : (now - t) / 60000;
}

/* ------------------------------------------------ x-li-page-instance -------- */
// Format verified against 46 live calls: urn:li:page:<pageKey>;<base64 of 16 random bytes>.
// The id is per PAGE VIEW -- several XHRs from one view share it -- so a fresh id per request is
// the honest analogue for a client that makes exactly one call per "view".
//
// Pinning a captured value would be worse than omitting the header: the same id arriving forever
// is an anomaly no real client produces. Generating one is the only correct option.
export const PAGE_KEYS = {
  profile: 'd_flagship3_profile_view_base',
  company: 'd_flagship3_company',
  feed:    'd_flagship3_feed',
  preload: 'd_flagship3_preload',
};

export function pageInstance(pageKey = PAGE_KEYS.profile) {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `urn:li:page:${pageKey};${btoa(String.fromCharCode(...b))}`;
}

/* ------------------------------------------------ Set-Cookie harvesting ----- */
// A browser stays logged in because it ABSORBS what the server sends: refs record that a real
// navigation triggers `server Set-Cookie -> persistent write of li_at`
// (refs/linkedin-internal-api/mcp/lib/session_browser.py:170), which is why browser-driven tools
// need no session maintenance at all (refs/linkedin-toolkit/references/endpoints.md:872,
// "cookies refresh themselves; no rotation maintenance").
//
// We discarded every Set-Cookie, so our jar was a frozen snapshot. This absorbs them instead.
//
// UNVERIFIED: whether a Voyager XHR response carries an li_at refresh at all, or whether
// re-affirmation is navigation-bound. Both ref citations describe navigations. If it is
// navigation-bound this harvests __cf_bm and little else -- still worth having, not a cure.

const DELETION_VALUES = new Set(['delete me', 'deleted', '']);

export function parseSetCookie(list) {
  return (list ?? []).map((raw) => {
    const [pair, ...attrs] = String(raw).split(';');
    const eq = pair.indexOf('=');
    if (eq < 1) return null;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const a = Object.fromEntries(attrs.map((s) => {
      const i = s.indexOf('=');
      return i < 0 ? [s.trim().toLowerCase(), true] : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
    }));
    const maxAge = a['max-age'] !== undefined ? Number(a['max-age']) : null;
    const expires = a.expires ? Date.parse(a.expires) : null;
    // LinkedIn kills a session with `set-cookie: li_at=delete me`
    // (refs/linkedin-cli/internal/api/client.go:76) -- a value, not an expiry.
    const deleting = DELETION_VALUES.has(value.replace(/^"|"$/g, ''))
      || maxAge === 0 || (expires !== null && !Number.isNaN(expires) && expires <= Date.now());
    return { name, value, deleting };
  }).filter(Boolean);
}

export function mergeCookies(jar, setCookieList, now = Date.now()) {
  const parsed = parseSetCookie(setCookieList);
  const order = [];
  const map = new Map();
  for (const c of String(jar ?? '').split(';')) {
    const s = c.trim(); if (!s) continue;
    const eq = s.indexOf('=');
    const name = eq < 1 ? s : s.slice(0, eq);
    if (!map.has(name)) order.push(name);
    map.set(name, s.slice(eq + 1));
  }
  const added = [], updated = [], removed = [];
  let sessionKilled = false;
  for (const c of parsed) {
    if (c.deleting) {
      if (c.name === 'li_at') sessionKilled = true;   // the unambiguous "re-login" signal
      if (map.delete(c.name)) removed.push(c.name);
      continue;
    }
    if (map.has(c.name)) { if (map.get(c.name) !== c.value) updated.push(c.name); }
    else { order.push(c.name); added.push(c.name); }
    map.set(c.name, c.value);
  }
  const out = order.filter((n) => map.has(n)).map((n) => `${n}=${map.get(n)}`).join('; ');
  return { jar: out, added, updated, removed, sessionKilled, capturedAt: new Date(now).toISOString() };
}
