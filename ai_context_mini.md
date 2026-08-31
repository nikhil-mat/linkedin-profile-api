# ORIENTATION — read this first

You are working on a **hosted read-only LinkedIn Profile API**: profile URL in, normalised JSON
out. **32 fields in one upstream request**, declared once in `src/schema.mjs` and enforced by
`node tools/schema.mjs check`. 103 offline tests. Everything is reverse-engineered from LinkedIn's private Voyager API.

This file is the map plus the facts you always need. Anything not inline here has a pointer
saying **what is in that file**, so you can decide whether to open it.

---

## 0. THE FIVE RULES — violating these has cost real accounts

1. **No writes. Ever.** Read-only is the product *and* the safety posture.
2. **One request at a time.** Never loop. Read each response before sending the next.
   Two incidents came from loops; one fired 36 authenticated requests in seconds.
3. **Never `redirect: 'follow'`** against Voyager. An invalid session self-redirects, so
   following loops ~20× in seconds — a burst far worse than the original call.
4. **Never retry a 429.** It is the warning shot on an escalation ladder
   (warning → 1–3 week restriction → permanent ban). Cooldown instead: 429 → 1 h, 999 → 6 h.
5. **Read the docs and `refs/` before spending a request** — most things worth knowing are
   already written down. **But verify before acting**: `refs/` are dated snapshots of a rotating
   API and have been confidently wrong (§4). Check a claim against `captures/*/raw.json` first;
   it is free, offline and instant.

Run the offline tests freely (`node --test tests/`, no network, no credentials). Live requests
are the scarce resource, not developer time.

---

## 1. Auth — the whole of it

```
cookie:                     li_at=<session>; JSESSIONID="ajax:<n>"
csrf-token:                 ajax:<n>        # JSESSIONID, QUOTES STRIPPED, ajax: prefix kept
x-restli-protocol-version:  2.0.0
accept:                     application/vnd.linkedin.normalized+json+2.1
user-agent:                 must match the browser+OS that minted the cookies
```

Two cookies, no OAuth, no API key. **No browser is needed for the calls** — it only mints the
cookies, and `/feed/` must load because that is what sets `JSESSIONID`.

- `li_at` = the login. Opaque, **not a JWT — never try to decode it**.
- `JSESSIONID` = the CSRF token. Set at login; does **not** rotate on its own.
- A mismatched pair produces a **302 self-redirect**, which looks nothing like an auth error.

---

## 2. The one call

```
GET /voyager/api/identity/dash/profiles
    ?q=memberIdentity&memberIdentity=<slug | bare ACoAA… id>    # full urn: → 400
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101
```

~92 KB, ~104 records, everything except the long tail. `-101` and `-109` both work.

Response is normalised: `data` holds URN **references**, `included[]` is a flat side-table keyed
by `entityUrn`. **Subject = `data["*elements"][0]`.**

The alternatives are dead or worse: `identity/profiles/{id}/profileView` is **HTTP 410**
(it kills the most-starred OSS client), the profile HTML is **999-blocked from datacenter IPs**,
and per-section GraphQL costs 13× the requests for identical data.

---

## 3. THE TRAPS — every bug in this project came from one of these

**The meta-trap, and the one to internalise:** *an empty or absent value is not proof of
absence.* Every single bug here was that mistake — a null read as "this person has none", a
missing field read as "the API doesn't have it". Check the payload before concluding.

| trap | reality |
|---|---|
| filtering `included[]` by `$type === Position` | attributes **other people's jobs** to the subject — graph-walk from the subject instead |
| `included.find($type === Profile)` | a response carries 2–3 Profile records — use `data["*elements"][0]` |
| `profilePicture.photoFilterType` | **wrong path** — it is at `profilePicture.photoFilterEditInfo.photoFilterType`; the wrong one reads `undefined` forever and never errors |
| `locationName` for profile location | `null` on every profile — resolve `geoLocation["*geo"]` → `Geo.defaultLocalizedName` |
| `Organization.position` | the field is **`positionHeld`** — the wrong name yields silent nulls |
| `Company.url` as the website | it is the LinkedIn **page**; the website is `websiteUrl` on a *different* record |
| taking one company record | company data is spread across **several** records — merge all matching the slug |
| sampling one record to learn a schema | `Position.locationName` is absent on some positions and present on others |
| only handling `vectorImage` | images are `{vectorImage}` **or** a plain `{url}` (LinkedIn defaults) |
| `ctype.includes('application/json')` | rejects **every success** — Voyager sends `…normalized+json+2.1` |
| trusting HTTP 200 | a 200 can carry `data.errors`. **The status code lies.** Parse the body. |
| `{text, attributes}` | AttributedText — unwrap recursively, and skip `multiLocale*` or every field duplicates |
| components under the section root | they live in `included[]`; walking the root returns **zero** |

**`paging.count` IS the cap, and it is in every `CollectionResponse`** — read it rather than
hardcoding. The "10 for position groups, 20 for most others" figures below are what it happens to
contain today, not constants.

⚠️ A ref will tell you not to: `refs/linkedin-internal-api/docs/27-JOBS.md` states as a hard rule
that `paging.count` must never be read because "it echoes the page size *we* sent". That is true
for the jobs-search route it describes and **wrong here** — profile collections are not paged by
us. A dated snapshot, correct in its own context, harmful in this one.

**Collections are silently capped** (10 position groups, 20 most others). `paging.total` is the
only discriminator: `total===returned` complete · `total>returned && returned>=cap` truncated ·
`total>returned && returned<cap` **unresolved (failed decoration)**. Two collections
(`*profileVideoPreview`, `*profileRingStatusCollection`) carry `paging` with **no `total`** —
treat as unknown.

**Throttling is silent**: HTTP 200, null section, no error — byte-identical to an unknown
section name *and* to a genuinely empty one. A null proves nothing.

---

## 4. WHERE TO LOOK — the map

### Our docs

| file | what is in it | open it when |
|---|---|---|
| `README.md` | The reviewer-facing document: how LinkedIn's API works, what you get, how it is built, what is unfinished. Prose, not reference — start here for orientation, come back here for facts. | you want the narrative |
| `docs/API.md` | The API in full. Pointers into `refs/` for mechanics, plus what we found that they lack: pagination, field shapes, the Android-hash/`accept` coupling, and §10's map of which repo snapshots which client. | you need endpoint or parsing detail beyond §2–3 above |
| `docs/OPERATIONS.md` | What it costs and how it breaks: failure-signal table, silent throttling, measured rate limits, five real incidents with causes, plus what rotates and three ways to get fresh hashes. | before any live traffic, or when something failed |
| `docs/BUILD.md` | What we built and why: architecture, the two limiters, a table of every bug with what caught it — plus the request/response contract (headers, envelope, `meta`, **upstream-status→outcome**, limits with provenance). | changing the service, or touching routes and error handling |
| `docs/SCHEMA.md` | **GENERATED** from `src/schema.mjs`: all 32 fields — 19 scalars, 13 lists — with each one's type, cost, and **source path in the payload**, and each list's item shape. Never hand-edit; run `node tools/schema.mjs docs`. | you need to know where a field comes from |
| `docs/TESTING.md` | The capture fixtures, what each exercises, exact expected counts, browser verification steps. | writing or debugging tests |
| `docs/EGRESS.md` | Routing Worker egress through a residential node you control. | deploying somewhere without residential egress |
| `docs/archive/07-RSC-FLIGHT-DECODING.md` | The React Flight decoder. Superseded as the main path, but still the **only** way to read follower/connection counts. | touching `enrich=counts` |
| `docs/archive/` | Superseded working notes. **Contains disproved conclusions.** | provenance only |

### `refs/` — upstream repos: read them, then verify them

**They document the mechanics better than we do; our docs are a wrapper, not a replacement.**
`API.md` §10 maps which repo snapshots which client and where each misleads — read it before
trusting any of them.

| for | read |
|---|---|
| the single best all-round reference | `refs/linkedin-toolkit/references/endpoints.md` — §1 auth, §10 the profile call + graph walk, §11 the `Q-*` gotcha catalogue, §13 the only measured rate table anywhere |
| queryId hashes, statically | `refs/linkedin-cli/API-REFERENCE.md` — 481 queries decompiled from the Android APK |
| endpoint breadth + honest verified/inferred labels | `refs/linkedin-internal-api/docs/` |
| the surface, defences, legal exposure | `refs/linkedin-relay/docs/research/R3-linkedin-surface.md` |
| ⚠️ do NOT trust for profile reads | `refs/linkedin-api` — a Nov-2024 snapshot; its whole profile path is 410 |

Six repos were read in depth; `linkedin_scraper` and `linkedin-voyager_api` were only skimmed.

#### ⚠️ They are close to gospel, not gospel — CHECK BEFORE YOU ACT

Every ref is a **dated snapshot of a rotating API**. They are right far more often than we are,
and they have still been confidently wrong. Real examples, all cost us time:

| the ref said | reality |
|---|---|
| `linkedin-mcp`: `148b1aeb…` is the *company* query | it is **guide-entry-points**; returns `{guideFetcher, entityUrn}` and nothing else. Captured correctly, **labelled** wrongly — cost six requests |
| `linkedin-toolkit` `Q-CSRF-EXACT`: keep the quotes on `csrf-token` | **strip them.** That repo's own §14 extraction regex strips them — it contradicts itself |
| `linkedin-api`: `profileView` returns the profile | **HTTP 410.** Nov-2024 snapshot; three repos inherit the dead path |
| `linkedin-mcp`: `148b1aeb…` "verified live 2026-06-13" | true *then*. Dates are load-bearing — a verified claim decays |

**Before acting on anything from a ref:**

1. **Check its date and client.** `API.md` §10 gives both. Anything tracing to `linkedin-api` is
   Nov-2024 legacy and probably 410. Android hashes may need `accept: application/json`.
2. **Verify against `captures/*/raw.json` first** — it is free, offline, and instant. Every doc
   error found so far was caught this way, never by re-reading prose.
3. **A ref's *name* for something can be wrong even when its capture is right.** Prefer the web
   bundle's own query registry (§5), which carries LinkedIn's name rather than a human's.
4. **Grep before claiming a finding is yours.** Three "✅ ours" claims in these docs turned out
   to already be in `refs/`. `grep -rl '<term>' refs/` settles it in seconds.

### Code

`api/src/index.js` routes · `api/src/classify.js` status→outcome · `api/src/upstream-do.js`
the outbound limiter · `api/src/transport.js` `guardedFetch`, the ONLY outbound call site ·
`src/profile-graph.mjs` the parser · `src/session.mjs` header construction, the kill switch,
cookie pruning · **`src/schema.mjs` the single field declaration** — add a field here and
nowhere else · `tools/schema.mjs` `check` (fails on drift, both directions) and `docs`
(regenerates `docs/SCHEMA.md`) · `tools/session-import.mjs` cURL → `.env` ·
`tools/queryids.mjs` extract hashes from a JS bundle.

There is **one output shape**, the nested profile. A flat one-row-per-profile rendering existed
until 2026-08-31 and was removed — if you find `flatten`, it is stale.

---

## 5. Getting fresh queryId hashes

Hashes are pinned to LinkedIn's deployed build and rotate. The web client's own JS bundle
registers every query as `{kind:"query", id:"<resource>.<32hex>", name:"<slug>"}` — so the
bundle is a **self-documenting catalogue of 933 queries**, from `static.licdn.com`, with **no
cookies and no API call**.

```bash
node tools/queryids.mjs <bundle.js> company
```

This is how `member-company-by-universal-name` was found after four wrong hashes. No reference
repo does it. Full procedure: `docs/OPERATIONS.md` §3.

**A hash is per QUERY SHAPE, not per resource.** Verified 2026-08-31 against a 46-call HAR of
live web-client traffic: one session used **three** different `voyagerOrganizationDashCompanies`
hashes, three for `voyagerIdentityDashProfiles`, two for `voyagerDashMySettings` — concurrently.
Different field selections against the same resource get different hashes.

Two consequences:

- **A hash that "doesn't match" is not necessarily stale.** It may be a different query against
  the same resource. This is the likeliest explanation of the old "four wrong company hashes"
  episode — they were probably valid hashes for queries we did not want.
- **Never look up a hash by resource name alone.** Match the query shape, or capture the exact
  call you mean to reproduce.

That HAR also confirmed, at n=46: our pinned company hash `3ffd8651…` is **live**; every
`/voyager/api/` response carries `server: cloudflare` (so Cloudflare Bot Management fronts the
endpoint we use, and its `__cf_bm` cookie applies to us); and the client sends
`referer: https://www.linkedin.com/preload/?_bprMode=vanilla` on **every** voyager XHR — even
ones whose `x-li-page-instance` says `profile_view`. Reasoning that the referer "should" be the
profile page was wrong.

---

## 6. Not solved

- `professionalEmail` — **not LinkedIn data**; scrapers that return it buy it from enrichment
  vendors (Dropcontact/Hunter). Declared in the schema with a reason, never fabricated.
- Whether a datacenter IP **kills** or merely **refuses** a session — n=1, unresolved.
  Unauthenticated calls from Cloudflare are served fine; the rendered document is 999-blocked.
- **Skills-scope pagination** — `ALL_SKILLS` was executed 2026-08-31 and returned **HTTP 500**
  with a Java serializer trace, not a rejection. `docs/API.md` §8 attributes that to the
  Android-hash/`accept` coupling, so `accept: application/json` is the suspected one-header fix.
  Untested. The experience scope IS verified: `start:10,count:10` returned exactly the two
  missing roles.
- **Session longevity.** `Set-Cookie` harvesting works in Node and workerd, but a live Voyager
  XHR returned **no `Set-Cookie` at all** — re-affirmation appears navigation-bound, so an
  API-only client never receives a refresh. What survives is `li_at=delete me` detection.
- Restricted/deleted profiles — untested; a 403 is ambiguous between a bad csrf header and a
  restricted profile.
- One fixture's About returns 0 newlines where the page shows paragraphs, while another keeps 11
  — **unexplained**. Do not assume newlines are stripped or preserved.

**Settled since, do not re-open:**

- `projects` and `testScores` are **proven** — a profile fetched 2026-08-31 returned 5 and 2.
  They were "never seen populated" for months; that is no longer true.
- `#OpenToWork` / `#Hiring` are **not in this decoration** and the fields were removed. They had
  been derived from `photoFilterType`, which is the photo EDITING filter (`ORIGINAL`, `STUDIO`,
  `None`) and cannot encode a frame — so every profile got a confident `false`, including two
  verified to carry the badges. No payload field holds them; `showPremiumSubscriberBadge` and
  `shouldShowSourceOfHireBadge` exist, so the badge namespace is present and simply lacks one.
