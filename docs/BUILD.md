# Build — architecture, coverage, and the API contract

---

## 1. Architecture

```
caller ──▶ Hono Worker (run LOCALLY — residential egress)
             ├── inbound limit   native CF rate-limit binding, keyed on x-api-key
             ├── classify        status + content-type + body  ──► outcome  (BEFORE parse)
             ├── upstream gate   Durable Object: serialise + pace + cooldown
             ├── fetch           1 × dash/profiles  (+ opt-in enrichment)
             ├── parse           index included[] by entityUrn → walk from data["*elements"][0]
             └── respond         { ok, profile, meta }
```

**Why the API runs on a laptop rather than deployed to Cloudflare:** the code *is* a normal
Worker and deploys unchanged, but authenticated reads need residential egress (`02` §3.1).
Hosting locally collapses the whole relay layer — one hop instead of three — and is exposed
publicly via `tailscale funnel`. Honest cost: laptop asleep ⇒ API down.

### Two rate limits, deliberately separate

| | mechanism | protects |
|---|---|---|
| inbound | native CF rate-limit binding, 30/60 s, keyed on API key | the service |
| outbound | **Durable Object** — 1 s + jitter, daily cap, cooldowns | the LinkedIn session |

The outbound limiter is a DO **because KV is eventually consistent (~60 s)**: concurrent requests
would all read the same stale `lastCall` and fire at once — the exact burst that gets an account
restricted. A DO is single-threaded and strongly consistent. It is a deliberate global
bottleneck: one session, one queue.

⚠️ `wrangler dev` does **not** simulate the native inbound binding locally. Local runs have no
inbound protection — which is how incident 5 (`02` §3.3) reached the account.

### Principles the code actually enforces

- **Never an empty success.** Failures are `ok:false` with a named cause; a genuinely empty
  section is `[]` with `state: "complete"`.
- **Three-state resolution.** `complete` / `truncated` (hit the cap, paginate) / `unresolved`
  (under the cap yet missing → failed decoration). Collapsing these loses "there is more" vs
  "we lost some".
- **Drift telemetry.** Unknown `$type`s pass through as data and are counted in
  `meta.unknownTypes`, never dropped. A test fails on any *new* unknown type.
- **Provenance on every cap** — `measured` vs `guessed`, surfaced at `GET /budget`.
- **Cooldowns, never retries.**

---

## 2. Coverage

Against the field set declared in `src/schema.mjs` — **32 fields: 19 scalars and 13 lists**:

| tier | count | evidence |
|---|---|---|
| ✅ from the **single** request | **30** | parsed from 9 real captures, pinned by 103 offline tests |
| ➕ opt-in, +1 request each | **2** | `connectionDegree` and `memberDistance` via `enrich=social`. Follower counts, company website and per-skill endorsements are also available this way, outside the declared field set |
| ❌ not obtainable | **1** | `professionalEmail` — not LinkedIn data; enrichment vendors sell it. Declared with a reason, never emitted as a null |

**48 of 49 proven. The one gap is not a gap in the implementation** — `professionalEmail` is bought from enrichment vendors, not scraped.

Also returned beyond that schema: about, languages, courses, honors, publications, patents,
organizations, volunteering, certifications, cover image, industry, premium, `photoFilterType`,
and opt-in interests + skill endorsements.

Never seen populated on any tested profile: `projects`, `testScores`. They resolve and return
`[]` correctly — but "returns `[]` correctly" and "returns rows correctly" are different claims.

### Enrichment (opt-in, +1 upstream request each)

| flag | source | status |
|---|---|---|
| `enrich=interests` | ProfileComponents `interests` | ✅ 23 rows parsed offline |
| `enrich=endorsements` | ProfileComponents `skills` | ✅ 14 skills, 3 endorsed |
| `enrich=social` | `identity/normalizedProfiles/<id>` | ⚠️ shapes **inferred**, never verified |
| `enrich=counts` | rendered document + Flight decode | ⚠️ parser verified, fetch untested; **needs residential egress** |

`enrich=social` declares itself: `PROVENANCE.verified` is empty and a test fails if anything
claims otherwise; the response carries `meta.unverified.social`.

---

## 3. Testing

`npm test` — **103 tests, no network, no credentials.** 66 run on a fresh clone; the other 37
read saved captures, which are gitignored because they hold real people's profile data. Every test pins a bug that actually happened:

| fixture | covers |
|---|---|
| `deep-history` | **both** truncation caps at once (positions 10/12, skills 20/36), publications, honors |
| `truncated-and-unresolved` | patents, `unresolved` collections, skills truncation |
| `unresolved-media` | about, languages, courses, organizations, `positionHeld` |
| `complete-at-cap` | the **cap boundary** — 10/10 must read `complete`, not truncated |
| sparse profile | empty arrays, no crash, `state: complete` |

Plus offline tests for endorsements, interests, topcard counts, and `normalizedProfiles` shape
tolerance.

---

## 4. Bugs found, and what found them

| bug | how it surfaced |
|---|---|
| `Organization.position` → silent nulls | a profile that actually had organizations |
| `locationName` "doesn't exist" | had sampled **one** Position record to infer the schema |
| images null for default cover | `displayImageReference` has two shapes — `{vectorImage}` and `{url}` |
| enrichment found zero entities | components live in `included[]`, not under the section root |
| follower count in the `name` field | positional text indexing instead of named slots |
| `experience: 13` vs `collections.experience: 10/12` | paging counts **groups**, output counts **positions** — same name, different units |
| connection degree "unavailable" | `unknownTypes` drift telemetry flagged `MemberRelationship` — it was in the payload all along |
| `companyWebsite` "not available to members" | wrong twice: the page HTML is **entity-escaped** so `grep '"websiteUrl"'` missed it, and the parser selected one node needing `universalName` AND `name` — while the record holding `websiteUrl` has `universalName` and no `name`. A company is described by SEVERAL records; merge them |
| four wrong company hashes | guessed from other repos' captures instead of reading the web bundle's own query registry, which names every hash |

The pattern: **every one was an empty-or-absent value read as proof of absence.** The
bogus-`sectionType` control test taught that lesson early and it still had to be relearned four
times.

---

## 5. Where the reference repos were wrong or incomplete

- Four of eight are built on `profileView`, which is **410**.
- None implements profile-collection pagination.
- `sectionType` IS partly documented — `linkedin-mcp/src/browser/endpoints.ts` enumerates 8
  tokens. Our contribution is the fuller set plus the finding that an unknown name is
  indistinguishable from an empty section.
- `Q-CSRF-EXACT` (keep the quotes) is contradicted by our every call.
- `voyagerJobsDashJobSeekerPreferences` is the **authenticated user's own** open-to-work state —
  wiring it for a third party would silently return *your* status for every profile scraped.

What they got right and saved us most: the two-cookie auth model, browserless viability, the
`Q-*` parsing gotchas, the one measured rate table, and the queryId-rotation warning.

---

## 6. Open

- ~~`enrich=social` shapes unverified~~ — **verified live 2026-08-31**; every inferred shape was correct.
- Skills-scope pagination (`ALL_SKILLS`) constructed but never executed.
- `projects` / `testScores` never seen populated.
- Restricted and deleted profiles untested; a `403` is reported without asserting which cause.
- **About newlines are inconsistent.** unresolved-media returns 0 newlines where the page shows
  paragraphs, but truncated-and-unresolved's summary keeps 11. Earlier docs asserted a universal
  `

` collapse; that was generalising from one profile and is withdrawn. Unexplained.
- ~~`credsFrom()` falls back to bound secrets~~ — **superseded 2026-08-31**: bound credentials
  are now the intended path, because the deliverable is a hosted URL a reviewer can call without
  LinkedIn cookies of their own. The lesson the guard encoded (a credential-less loop silently
  spending the owner's session, 36 calls) is enforced instead by the Durable Object's pacing and
  daily cap, and by the `UPSTREAM_DISABLED` hard stop at the fetch chokepoint.
- The queryId catalogue technique (933 queries from the web bundle, no cookies) is the single
  most reusable finding and deserves its own tooling.

---


The service layer: request shape, response envelope, status mapping and limits. An independent
doc-only rebuild reported this layer was *"guessed throughout"* because no document specified
it — this file is that specification. Values come from the code (`api/src/classify.js`,
`api/src/upstream-do.js`, `api/wrangler.toml`).

---

## Request

```
GET /profile?url=<profile url | slug>
    &enrich=social,counts,company,interests,endorsements   optional, +1 upstream request each
```

| header | required | meaning |
|---|---|---|
| `x-li-at` | no | with `x-li-jsessionid`, spends your account instead of the server's |
| `x-li-jsessionid` | no | with `x-li-at`, overrides the server's session (quotes optional) |
| `x-li-ua` | no | `windows` \| `macos` \| full UA — **must match the browser/OS that minted the cookies** |
| `x-api-key` | no | inbound rate-limit key; falls back to client IP |

Credentials are **bound, not per request**: the server reads one session from `.env` /
`api/.dev.vars`, which is what makes a hosted URL usable by a caller who has no LinkedIn cookies
of their own. Request headers (`x-li-at` + `x-li-jsessionid`) remain an optional override for
spending a different account. Every call spends the operator's session, so the URL is the
credential and is shared privately.

---

## Success envelope

```jsonc
{
  "ok": true,
  "profile": { /* the nested shape — see docs/SCHEMA.md */ },
  "meta": {
    "state": "complete" | "partial",   // partial ⇒ something truncated or unresolved
    "includedCount": 104,
    "collections": {
      "experience": { "total": 12, "returned": 10, "cap": 10, "state": "truncated",
                      "truncated": true, "unresolved": false, "unit": "positionGroups" }
    },
    "truncated":   ["experience (10/12)"],  // hit the cap — more exist upstream
    "unresolved":  [],                      // under the cap yet missing ⇒ failed decoration
    "unknownTypes": [],                     // drift telemetry — counted, never dropped
    "upstreamMs": 971,
    "upstreamRequests": 1,                  // true cost, including enrichment
    "egress": "direct" | "relay",
    "credentialSource": "request" | "binding",
    "enrichmentSkipped": { "counts": "REQUEST_DENIED (HTTP 999)" },  // only when skipped
    "unverified": { }                       // only when a parser's shapes are inferred
  }
}
```

⚠️ **`unit` matters.** `collections.experience` counts position **GROUPS** (one per company);
`profile.experience` is the flattened list of **positions**. Seven groups can yield ten roles,
so the two numbers differing is correct, not a bug.

---

## Failure envelope

**Never an empty success.** A failure is `ok:false` with a named cause; a genuinely empty
section is `[]` with `state: "complete"`.

```jsonc
{ "ok": false, "error": "SESSION_INVALID", "upstreamStatus": 302,
  "retryable": false, "hint": "…", "egress": "direct" }
```

### Upstream status → outcome (this is the direction `classify()` runs)

Classify **before** parsing. A 302/410/999 handed to a parser yields a plausible *empty profile*,
indistinguishable from a real one.

| upstream signal | outcome | note |
|---|---|---|
| `200` **and** body has `data.errors` / `errors` | `SCHEMA_DRIFT` | **the status code lies** — check the body first |
| `200` | `OK` | |
| `3xx` with `Location` matching `/uas/login`, `/checkpoint`, `/login` | `SESSION_INVALID` | |
| `3xx` with `Location` equal to the request URL (self-redirect) | `SESSION_INVALID` | session/CSRF no longer accepted — re-extract cookies |
| any other `3xx` | `SESSION_INVALID` | |
| `401` | `SESSION_INVALID` | |
| `403` | `CSRF_REJECTED` | ⚠️ **ambiguous**: a malformed csrf header *or* that one profile is restricted. There is no way to tell from the response. Probe `/voyager/api/me`: 200 there ⇒ the session is fine and the profile is the problem. Treat 5+ consecutive as a session issue. |
| `404` | `NOT_FOUND` | |
| `410` | `GONE` | endpoint retired — re-plan, do not retry |
| `429` | `RATE_LIMITED` | opens a 1 h cooldown |
| `999` | `REQUEST_DENIED` | network-layer bot block; 6 h cooldown |
| `400` | `SCHEMA_DRIFT` | decoration/queryId rotated, or a full `urn:` passed to `memberIdentity` |
| anything else | `UPSTREAM_ERROR` | never assume retryable |

Also verify the content type: Voyager answers `application/vnd.linkedin.normalized+json+2.1`, so
a naive `includes('application/json')` check **rejects every successful response**. Match `+json`.

### Outcome → HTTP (what the caller sees)

| outcome | HTTP | retryable | meaning |
|---|---|---|---|
| `SESSION_INVALID` | 401 | false | re-extract li_at + JSESSIONID from the browser; they must come from the same session. Pres |
| `CSRF_REJECTED` | 401 | false | csrf-token must equal JSESSIONID with quotes stripped (ajax: prefix kept) |
| `FORBIDDEN` | 403 | false | this specific profile may be restricted; 5+ consecutive means a session problem |
| `NOT_FOUND` | 404 | false | no such public identifier |
| `RATE_LIMITED` | 429 | false | upstream throttled — do NOT retry; a cooldown is now in force |
| `REQUEST_DENIED` | 429 | false | HTTP 999 network-layer block; stop generating traffic for hours |
| `SCHEMA_DRIFT` | 502 | false | decoration id likely rotated; re-capture it |
| `GONE` | 502 | false | endpoint retired |
| `UPSTREAM_ERROR` | 502 | false | — |
| `bad_request` | 400 | false | missing or unparsable `?url=` |
| `no_credentials` | 401 | false | credential headers absent, bound fallback disabled |
| `rate_limit_exceeded` | 429 | — | **inbound** limit, scope `caller` |
| `upstream_budget` | 429 | false | **outbound** limit: `COOLDOWN` or `DAILY_CAP` |
| `PARSE_FAILED` | 502 | false | 200 received, body did not parse |

**Nothing is retryable.** A 429 from LinkedIn is the warning shot on an escalation ladder;
retrying is what turns a warning into a restriction.

---

## Limits

| | value | provenance |
|---|---|---|
| inbound | 30 req / 60 s, keyed on `x-api-key` (IP fallback) | chosen |
| outbound min interval | 1000 ms + 0–1500 ms jitter | **measured** (`linkedin-toolkit` §13) |
| outbound daily cap | 200 | **guessed** — deliberately conservative |
| cooldown after 429 | 1 hour | reasoned |
| cooldown after 999 | 6 hours | reasoned |

Every cap carries its provenance in code and at `GET /budget`, so a guess is never mistaken for
a measurement. Inbound is keyed on an API key rather than IP per Cloudflare's own guidance —
IPs are shared by many legitimate users.

⚠️ `wrangler dev` does **not** simulate the native inbound rate-limit binding locally, so local
runs have no inbound protection.

---

## Other routes

| route | upstream calls | returns |
|---|---|---|
| `GET /` | 0 | service description |
| `GET /health` | 0 | `{ok, egress, credentialsBound}` |
| `GET /budget` | 0 | spend today, cap, provenance, cooldown state |

`/health` and `/budget` make **no** upstream call and are safe to poll.
