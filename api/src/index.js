import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { parseProfile } from './parse.js';
import { FIELDS, UNAVAILABLE, ENRICHMENT } from '../../src/schema.mjs';
import { classify, OUTCOMES } from './classify.js';
import { upstreamDisabled, mergeCookies } from '../../src/session.mjs';
import { fetchProfile, fetchSection, fetchDocument, fetchNormalized, fetchCompany } from './transport.js';
import { parseCompany } from './company.js';
import { parseNormalized, PROVENANCE as NORMALIZED_PROVENANCE } from './normalized.js';
import { UI } from './ui.js';
import { topcardCounts } from './topcard.js';
import { skillEndorsements, interests } from './enrich.js';
import { callLimiter, BUDGET } from './upstream-do.js';
export { UpstreamLimiter } from './upstream-do.js';

const app = new Hono();
app.use('*', logger());
app.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'x-api-key', 'x-li-at', 'x-li-jsessionid'] }));

/* ------------------------------------------------------------------ helpers */
const slugFrom = (input = '') => {
  const m = String(input).match(/linkedin\.com\/in\/([^/?#]+)/i);
  const slug = (m ? m[1] : String(input)).trim().replace(/\/+$/, '');
  return /^[\w-]{2,100}$/.test(slug) ? slug : null;
};

// The service holds ONE operator session, bound from .env / api/.dev.vars, and answers on behalf
// of whoever calls it. That is a deliberate choice for a hosted deployment: a reviewer gets a URL
// and it works, with no LinkedIn cookies of their own.
//
// The trade it makes: every call spends the OPERATOR's account, so the link is the credential.
// Share it privately. The protections that remain are the ones that matter for that model --
// the Durable Object paces and caps every upstream call, and UPSTREAM_DISABLED is a hard stop.
//
// (Until 2026-08-31 this required ALLOW_BOUND_CREDENTIALS=true, because a loop of deliberately
// credential-less requests had silently carried the owner's session and put 36 authenticated
// calls on the account. Bound credentials are now the intended path, so that guard is gone --
// but the lesson it encoded is enforced elsewhere: never loop, and read the first response.)
const credsFrom = (c) => {
  const shared = {
    ua:             c.req.header('x-li-ua') || c.env.LINKEDIN_USER_AGENT,
    cookies:        c.env.LINKEDIN_COOKIES,
    secChUa:        c.env.LINKEDIN_SEC_CH_UA,
    acceptLanguage: c.env.LINKEDIN_ACCEPT_LANGUAGE,
    xLiTrack:       c.env.LINKEDIN_X_LI_TRACK,
    extraHeaders:   c.env.LINKEDIN_EXTRA_HEADERS,
  };
  // A caller MAY still present their own session, which then spends their account instead of
  // ours. Useful for testing; never required.
  const liAt = c.req.header('x-li-at'), jsession = c.req.header('x-li-jsessionid');
  if (liAt && jsession) return { ...shared, liAt, jsession, source: 'request' };

  if (!c.env.LINKEDIN_LI_AT || !c.env.LINKEDIN_JSESSIONID) return null;
  return { ...shared, liAt: c.env.LINKEDIN_LI_AT, jsession: c.env.LINKEDIN_JSESSIONID,
           source: 'binding' };
};

/* -------------------------------------------------------------- inbound limit */
// Prefers an API key, falling back to the caller IP. The preference matters -- CF's own guidance
// is that IPs are shared by many legitimate users -- but note the fallback IS the common case
// here: the hosted model needs no caller credentials, so most traffic carries no x-api-key and
// is bucketed by IP, and anything with neither collapses onto one shared 'anonymous' bucket.
async function inboundLimit(c) {
  if (!c.env.API_RATE_LIMITER) return { ok: true, skipped: true };
  const key = c.req.header('x-api-key') || c.req.header('cf-connecting-ip') || 'anonymous';
  return c.env.API_RATE_LIMITER.limit({ key });
}

/* -------------------------------------------------------------------- routes */
app.get('/', (c) => c.json({
  service: 'linkedin-profile-api',
  endpoints: {
    'GET /profile?url=<profile url|slug>': 'normalised profile JSON',
        'GET /profile?url=…&enrich=social,counts,endorsements,interests': 'opt-in, +1 upstream request each. social=followers/badges/contact (any egress, shapes unverified); counts=connection count (needs residential egress)',
    'GET /ui': 'local web console (browser)',
    'GET /health': 'liveness, no upstream call',
    'GET /budget': 'upstream spend + cooldown state',
  },
  credentials: 'per-request headers x-li-at + x-li-jsessionid (preferred), or bound secrets',
  egress: c.env.RELAY_URL ? 'relay' : 'direct',
}));

// Local console. Same-origin, so it calls /profile directly; credentials never leave the machine.
app.get('/ui', (c) => c.html(UI));

// The API describes its own output. The console renders its field table from this rather than
// carrying a second copy of the list -- that duplication is what let a field be forgotten.
app.get('/schema', (c) => c.json({ ok: true, count: FIELDS.length, fields: FIELDS,
                                  unavailable: UNAVAILABLE, enrichment: ENRICHMENT }));

app.get('/health', (c) => c.json({ ok: true, egress: c.env.RELAY_URL ? 'relay' : 'direct',
                                   credentialsBound: !!c.env.LINKEDIN_LI_AT }));

app.get('/budget', async (c) => {
  if (!c.env.UPSTREAM_LIMITER) return c.json({ error: 'no limiter bound', budget: BUDGET }, 501);
  const r = await callLimiter(c.env, { action: 'status' });
  return c.json(await r.json());
});

app.get('/profile', async (c) => {
  const rl = await inboundLimit(c);
  if (!rl.success && !rl.skipped) {
    return c.json({ ok: false, error: 'rate_limit_exceeded', scope: 'caller' }, 429);
  }

  const slug = slugFrom(c.req.query('url') || c.req.query('slug') || '');
  if (!slug) return c.json({ ok: false, error: 'bad_request', hint: 'pass ?url=https://www.linkedin.com/in/<slug>/' }, 400);

  const creds = credsFrom(c);
  if (!creds) return c.json({ ok: false, error: 'no_credentials',
    hint: 'the server has no session bound. Import one: node tools/session-import.mjs <curl-file>, '
        + 'then restart the worker so it reloads api/.dev.vars' }, 401);

  // Armed kill switch: answer before anything is built. The transport enforces this too --
  // this check exists only to return a clear 503 instead of a generic transport error.
  if (upstreamDisabled(c.env)) return c.json({ ok: false, error: 'upstream_disabled',
    hint: 'UPSTREAM_DISABLED is armed; unset it in api/.dev.vars (or the Worker vars) to allow live requests',
    retryable: false }, 503);

  // The UA is part of the session, not a default. Refusing here is deliberate: on 2026-08-31
  // a defaulted Windows UA went out on a macOS-minted cookie for every live request.
  if (!creds.ua) return c.json({ ok: false, error: 'no_user_agent',
    hint: 'set LINKEDIN_USER_AGENT (or send x-li-ua) to the browser+OS that minted li_at: "macos", "windows", or the exact UA string' }, 400);

  // Serialise + pace every upstream call through the Durable Object.
  if (c.env.UPSTREAM_LIMITER) {
    const gate = await (await callLimiter(c.env, { action: 'acquire' })).json();
    if (!gate.ok) {
      return c.json({ ok: false, error: 'upstream_budget', ...gate,
        hint: gate.reason === 'COOLDOWN' ? 'a cooldown is in force after a throttling signal; do not retry'
                                          : 'daily upstream cap reached' }, 429);
    }
  }

  let res;
  try { res = await fetchProfile(c.env, creds, slug); }
  catch (e) { return c.json({ ok: false, error: 'transport_error', detail: String(e).slice(0, 200) }, 502); }

  const outcome = classify(res.status, res.location, res.url);
  if (c.env.UPSTREAM_LIMITER) await callLimiter(c.env, { action: 'record', outcome });

  // What the server sent back. A browser stays logged in by absorbing these; we surface them so
  // a refreshed li_at (or the `li_at=delete me` kill signal) is visible rather than discarded.
  const harvest = mergeCookies(c.env.LINKEDIN_COOKIES ?? '', res.setCookie ?? []);
  if (harvest.sessionKilled) {
    return c.json({ ok: false, error: 'SESSION_KILLED', upstreamStatus: res.status, retryable: false,
      hint: 'LinkedIn sent `set-cookie: li_at=delete me` — this session is dead; re-login and re-import' }, 401);
  }

  if (outcome !== 'OK') {
    const spec = OUTCOMES[outcome] ?? OUTCOMES.UPSTREAM_ERROR;
    // Never an empty success: a failure is ok:false with a named cause, not an empty profile.
    return c.json({ ok: false, error: outcome, upstreamStatus: res.status,
                    retryable: spec.retryable ?? false, hint: spec.hint, egress: res.egress }, spec.http);
  }

  let parsed;
  try { parsed = parseProfile(JSON.parse(res.body)); }
  catch (e) { return c.json({ ok: false, error: 'PARSE_FAILED', detail: String(e).slice(0, 200) }, 502); }

  const cookiesRefreshed = [...harvest.updated, ...harvest.added];
  const meta = { ...parsed.meta, upstreamMs: res.ms, egress: res.egress,
                 ...(cookiesRefreshed.length ? { cookiesRefreshed } : {}),
                 credentialSource: creds.source, upstreamRequests: 1 };

  // Opt-in enrichment. Each section is one MORE upstream request and each passes through the
  // same limiter, so the caller chooses to spend it -- never implicit.
  const want = (c.req.query('enrich') || '').split(',').map(s => s.trim()).filter(Boolean);
  const ENRICHERS = { endorsements: ['skills', skillEndorsements], interests: ['interests', interests] };

  // `social` reads a different Voyager resource for follower count / badges / contact fields.
  // Preferred over `counts`: plain JSON, and it works from any egress.
  // ⚠️ Its field shapes are INFERRED, never verified — see normalized.js PROVENANCE.
  if (want.includes('social')) {
    let allowed = true;
    if (c.env.UPSTREAM_LIMITER) {
      const gate = await (await callLimiter(c.env, { action: 'acquire' })).json();
      allowed = gate.ok;
      if (!gate.ok) meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), social: gate.reason };
    }
    if (allowed) {
      try {
        const nr = await fetchNormalized(c.env, creds, parsed.profile.profileId);
        const oc = classify(nr.status, nr.location, nr.url);
        if (c.env.UPSTREAM_LIMITER) await callLimiter(c.env, { action: 'record', outcome: oc });
        if (oc !== 'OK') {
          meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), social: oc };
        } else {
          const extra = parseNormalized(JSON.parse(nr.body));
          for (const [k, v] of Object.entries(extra)) if (v != null) parsed.profile[k] ??= v;
          meta.upstreamRequests += 1;
          meta.unverified = { ...(meta.unverified ?? {}), social: NORMALIZED_PROVENANCE.note };
        }
      } catch {
        meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), social: 'PARSE_FAILED' };
      }
    }
  }

  // `company` resolves the CURRENT employer's own website. Only the current company, so the
  // cost stays one request rather than one per position.
  if (want.includes('company')) {
    const slug2 = parsed.profile.experience?.[0]?.companySlug;
    if (!slug2) {
      meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), company: 'NO_COMPANY_SLUG' };
    } else {
      let allowed = true;
      if (c.env.UPSTREAM_LIMITER) {
        const gate = await (await callLimiter(c.env, { action: 'acquire' })).json();
        allowed = gate.ok;
        if (!gate.ok) meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), company: gate.reason };
      }
      if (allowed) {
        try {
          const cr = await fetchCompany(c.env, creds, slug2);
          const oc = classify(cr.status, cr.location, cr.url);
          if (c.env.UPSTREAM_LIMITER) await callLimiter(c.env, { action: 'record', outcome: oc });
          if (oc !== 'OK') {
            // Carry the HTTP status so a failure is diagnosable without spending another
            // request to find out what happened.
            meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), company: `${oc} (HTTP ${cr.status})` };
          } else {
            const raw = JSON.parse(cr.body);
            parsed.profile.company = parseCompany(raw, slug2);
            meta.upstreamRequests += 1;
            // A 200 can still carry `data.errors` -- the documented false-success case. Surface
            // it rather than reporting an all-null company as if it were real data.
            const gqlErrors = raw?.data?.errors ?? raw?.errors ?? null;
            if (gqlErrors) meta.upstreamErrors = { ...(meta.upstreamErrors ?? {}), company: gqlErrors };
            if (c.req.query('debug') === '1') {
              meta.debug = { ...(meta.debug ?? {}), company: {
                bytes: cr.body.length,
                topKeys: Object.keys(raw ?? {}),
                dataKeys: raw?.data ? Object.keys(raw.data) : null,
                includedTypes: [...new Set((raw?.included ?? []).map(x => String(x?.$type).split('.').pop()))].slice(0, 12),
                head: cr.body.slice(0, 4000),
                companyKeys: (raw?.included ?? [])
                  .filter(x => String(x?.$type).endsWith('.Company'))
                  .map(x => Object.keys(x).filter(k => !k.startsWith('$'))),
              } };
            }
          }
        } catch {
          meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), company: 'PARSE_FAILED' };
        }
      }
    }
  }

  // `counts` is not a components section -- it scrapes the rendered document, the only place
  // follower/connection counts exist. Handled separately from the section enrichers.
  if (want.includes('counts')) {
    let gated = true;
    if (c.env.UPSTREAM_LIMITER) {
      const gate = await (await callLimiter(c.env, { action: 'acquire' })).json();
      gated = gate.ok;
      if (!gate.ok) meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), counts: gate.reason };
    }
    if (gated) {
      try {
        const doc = await fetchDocument(c.env, creds, slug);
        const oc = classify(doc.status, doc.location, doc.url);
        if (c.env.UPSTREAM_LIMITER) await callLimiter(c.env, { action: 'record', outcome: oc });
        if (oc !== 'OK') {
          // A 999 here means the document surface is blocked for this egress (datacenter IP).
          meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), counts: oc };
        } else {
          Object.assign(parsed.profile, topcardCounts(doc.body));
          meta.upstreamRequests += 1;
        }
      } catch {
        meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), counts: 'PARSE_FAILED' };
      }
    }
  }
  for (const name of want) {
    const spec = ENRICHERS[name];
    if (!spec) continue;
    const [sectionType, extract] = spec;
    if (c.env.UPSTREAM_LIMITER) {
      const gate = await (await callLimiter(c.env, { action: 'acquire' })).json();
      if (!gate.ok) { meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), [name]: gate.reason }; continue; }
    }
    try {
      const sec = await fetchSection(c.env, creds, parsed.profile.profileId, sectionType);
      const oc = classify(sec.status, sec.location, sec.url);
      if (c.env.UPSTREAM_LIMITER) await callLimiter(c.env, { action: 'record', outcome: oc });
      if (oc !== 'OK') { meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), [name]: oc }; continue; }
      const rows = extract(JSON.parse(sec.body));
      // A silently-null section is throttling, NOT an empty section -- do not report it as data.
      if (!rows.length) { meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), [name]: 'EMPTY_OR_THROTTLED' }; continue; }
      parsed.profile[name] = rows;
      meta.upstreamRequests += 1;
    } catch (e) {
      meta.enrichmentSkipped = { ...(meta.enrichmentSkipped ?? {}), [name]: 'PARSE_FAILED' };
    }
  }

  return c.json({ ok: true, profile: parsed.profile, unavailable: UNAVAILABLE, meta });
});

app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));
app.onError((err, c) => c.json({ ok: false, error: 'internal', detail: String(err).slice(0, 200) }, 500));

export default app;
