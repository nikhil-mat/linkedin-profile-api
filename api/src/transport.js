// Upstream transport. Egress is PLUGGABLE, and that is load-bearing rather than tidy:
//
//   direct — Worker fetches LinkedIn from a Cloudflare datacenter IP.
//            Observed 2026-08-30: a browser-minted session used once this way was INVALIDATED
//            everywhere afterwards. Unauthenticated calls are served fine (clean 403, never
//            999), so this is not a network block -- LinkedIn will not let a session live on a
//            datacenter origin. Left in only for unauthenticated probes and testing.
//
//   relay  — Worker calls a relay on a machine you control (see docs/11-EGRESS-RELAY.md), which
//            makes the outbound request from a residential IP. This is the supported mode for
//            authenticated reads.
import { upstreamHeaders, profileReferer, assertUpstreamAllowed,
         PAGE_KEYS } from '../../src/session.mjs';

const DECO = 'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101';

// Header construction is shared with the local scripts (src/session.mjs). It used to be
// duplicated here and the two copies had already drifted -- this one was missing `referer`.
export { upstreamHeaders };

// EVERY outbound request in this file goes through here. Do not call fetch() directly.
async function guardedFetch(env, url, init) {
  assertUpstreamAllowed(env, url);   // hard stop; the ONLY refusal. A bundle is never too old:
  return fetch(url, init);           // li_at runs ~12 months, so we prune cookies, not requests.
}

export function profileUrl(slug, decoration) {
  return 'https://www.linkedin.com/voyager/api/identity/dash/profiles'
    + `?q=memberIdentity&memberIdentity=${encodeURIComponent(slug)}`
    + `&decorationId=${decoration || DECO}`;
}

// NEVER redirect:'follow'. Voyager answers an invalid session with a redirect to the SAME url,
// so following it loops ~20 times before the runtime aborts -- a burst of authenticated hits
// that is far more dangerous than the original request.
export async function fetchProfile(env, creds, slug) {
  const url = profileUrl(slug, env.LINKEDIN_PROFILE_DECORATION);
  const headers = upstreamHeaders(creds, { capturedAt: env.LINKEDIN_SESSION_CAPTURED_AT,
                                          pageKey: PAGE_KEYS.profile });
  const t0 = Date.now();

  if (env.RELAY_URL) {
    const r = await guardedFetch(env, `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
      headers: {
        'x-relay-secret': env.RELAY_SECRET ?? '',
        // the relay forwards only x-fwd-* prefixed headers, so the client keeps control of its identity
        ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [`x-fwd-${k}`, v])),
      },
    });
    if (!r.ok) return { status: 502, body: '', ms: Date.now() - t0, egress: 'relay',
                        relayError: `relay HTTP ${r.status}` };
    const j = await r.json();
    return { status: j.status, body: j.body ?? '', location: j.location,
             ms: Date.now() - t0, egress: 'relay' };
  }

  const r = await guardedFetch(env, url, { headers, redirect: 'manual' });
  return { status: r.status, body: await r.text(), location: r.headers.get('location'),
           setCookie: r.headers.getSetCookie?.() ?? [],
           ms: Date.now() - t0, egress: 'direct', url };
}

/* ------------------------------------------------------- optional enrichment */
// Each of these is ONE extra upstream request, so they are opt-in per call rather than always
// fetched. The section parsers are verified offline against saved captures (tests/).
const COMPONENTS_QUERY = 'voyagerIdentityDashProfileComponents.86824295e1093fb0f5acdd8d57213aaa';

export async function fetchSection(env, creds, profileId, sectionType) {
  const urn = encodeURIComponent(`urn:li:fsd_profile:${profileId}`);
  const url = 'https://www.linkedin.com/voyager/api/graphql'
    + `?queryId=${COMPONENTS_QUERY}&variables=(profileUrn:${urn},sectionType:${sectionType})`;
  const headers = upstreamHeaders(creds);

  if (env.RELAY_URL) {
    const r = await guardedFetch(env, `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { 'x-relay-secret': env.RELAY_SECRET ?? '',
                 ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [`x-fwd-${k}`, v])) },
    });
    if (!r.ok) return { status: 502, body: '' };
    const j = await r.json();
    return { status: j.status, body: j.body ?? '', location: j.location };
  }
  const r = await guardedFetch(env, url, { headers, redirect: 'manual' });
  return { status: r.status, body: await r.text(), location: r.headers.get('location'),
           setCookie: r.headers.getSetCookie?.() ?? [], url };
}

// The profile DOCUMENT (~900 KB). Only source for follower/connection counts, which are display
// text on the top card rather than fields in the Voyager decoration.
// ⚠️ 999-blocked from datacenter IPs — residential egress only.
export async function fetchDocument(env, creds, slug) {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  const headers = { ...upstreamHeaders(creds), accept: 'text/html,application/xhtml+xml' };
  if (env.RELAY_URL) {
    const r = await guardedFetch(env, `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { 'x-relay-secret': env.RELAY_SECRET ?? '',
                 ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [`x-fwd-${k}`, v])) },
    });
    if (!r.ok) return { status: 502, body: '' };
    const j = await r.json();
    return { status: j.status, body: j.body ?? '', location: j.location };
  }
  const r = await guardedFetch(env, url, { headers, redirect: 'manual' });
  return { status: r.status, body: await r.text(), location: r.headers.get('location'),
           setCookie: r.headers.getSetCookie?.() ?? [], url };
}

// A DIFFERENT Voyager resource from the profile decoration. Carries follower count, connection
// distance, badges and contact fields. Plain JSON, and NOT the 999-blocked document surface —
// so unlike the topcard scrape this works from any egress, Cloudflare included.
export async function fetchNormalized(env, creds, profileId) {
  const url = `https://www.linkedin.com/voyager/api/identity/normalizedProfiles/${encodeURIComponent(profileId)}`;
  const headers = upstreamHeaders(creds);
  if (env.RELAY_URL) {
    const r = await guardedFetch(env, `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { 'x-relay-secret': env.RELAY_SECRET ?? '',
                 ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [`x-fwd-${k}`, v])) },
    });
    if (!r.ok) return { status: 502, body: '' };
    const j = await r.json();
    return { status: j.status, body: j.body ?? '', location: j.location };
  }
  const r = await guardedFetch(env, url, { headers, redirect: 'manual' });
  return { status: r.status, body: await r.text(), location: r.headers.get('location'),
           setCookie: r.headers.getSetCookie?.() ?? [], url };
}

// Company detail by universal name (the slug already present on the parsed profile).
// queryId documented + verified live 2026-06-13 by linkedin-mcp.
// Company detail by universal name.
//
// Hash source: the web client's own JS bundle registers every query as
//   {kind:"query", id:"<resource>.<32-hex>", name:"<slug>"}
// so the bundle is a self-documenting queryId catalogue — no traffic capture needed, and it is
// fetched from static.licdn.com with NO cookies. Extracted 2026-08-31:
//   3ffd8651…  member-company-by-universal-name          <- member-facing view (we are a member)
//   f8854567…  organization-companies-by-universal-name  <- admin/org view
//   bd2de7b5…  company-stock-quote
//   148b1aeb…  guide entry points (returns {guideFetcher, entityUrn} only — NOT a company read)
const COMPANY_QUERY = 'voyagerOrganizationDashCompanies.3ffd865170edb9221ae387112762de30';

export async function fetchCompany(env, creds, universalName) {
  // This query requires a second NonNull variable. LinkedIn's GraphQL errors name the variable
  // they want -- read the body, do not guess the schema. (Same lesson as `pagedListComponent`.)
  const url = `https://www.linkedin.com/voyager/api/graphql?queryId=${COMPANY_QUERY}`
    + `&variables=(universalName:${encodeURIComponent(universalName)})`;
  const headers = upstreamHeaders(creds);
  if (env.RELAY_URL) {
    const r = await guardedFetch(env, `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(url)}`, {
      headers: { 'x-relay-secret': env.RELAY_SECRET ?? '',
                 ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [`x-fwd-${k}`, v])) },
    });
    if (!r.ok) return { status: 502, body: '' };
    const j = await r.json();
    return { status: j.status, body: j.body ?? '', location: j.location };
  }
  const r = await guardedFetch(env, url, { headers, redirect: 'manual' });
  return { status: r.status, body: await r.text(), location: r.headers.get('location'),
           setCookie: r.headers.getSetCookie?.() ?? [], url };
}
