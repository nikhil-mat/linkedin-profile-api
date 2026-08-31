# 08 — Synthesised model: how LinkedIn's private profile API actually works

> **Status (updated 2026-08-31).** Architecture still correct and is what shipped. Numbers are stale: coverage is now **50 of PhantomBuster's 51 fields**, pagination is solved, and `enrich=social` / `counts` / `company` are verified live.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


Written after reading all eight reference repos end to end, and re-testing their claims live
against one account on 2026-08-30. This supersedes the architecture in `07-RSC-FLIGHT-DECODING.md`
§§1–9, which is kept because the reasoning is still instructive, not because it is the way to
build this.

The short version: **the React Flight decoding was never necessary, and neither is the section
fan-out.** A single decorated REST call returns the profile.

---

## 1. There are three generations of profile API, not one

Reading the repos in date order makes the migration visible. Every repo is a snapshot of a
different generation, which is why they contradict each other.

| Gen | Shape | Status on 2026-08-30 | Evidence |
|---|---|---|---|
| **Legacy** `identity/profiles/{id}/profileView` | one monolithic JSON, all sections | **410 Gone** — tested | `linkedin-api` 2.3.1 is built entirely on this |
| **Dash REST** `identity/dash/profiles?q=memberIdentity&decorationId=…` | normalised `{data, included[]}` graph | **200, and it is the answer** | `linkedin-toolkit`, `linkedin-mcp` |
| **Dash GraphQL** `graphql?queryId=voyagerIdentityDashProfileComponents.<hash>` | SDUI render-tree per section | **200**, needed only for the long tail | `linkedin-internal-api`, our own work |

`linkedin-api` is the most-starred reference and its profile path is **dead**. Its own source
carries the comment *"still works for now, but will probably eventually have to be converted"*.
It has been. Anything derived from that repo's `get_profile()` should be discarded outright.

> This is the single most important thing the reading produced. Four of the eight repos are
> built on an endpoint that now returns 410.

## 2. Auth is two cookies, and the browser is not in the request path

Unanimous across `linkedin-internal-api`, `linkedin-toolkit`, `linkedin-relay` and
`linkedin-api`, and re-verified here:

```
cookie:                     li_at=<session>; JSESSIONID="ajax:<n>"
csrf-token:                 ajax:<n>            # JSESSIONID, quotes stripped
x-restli-protocol-version:  2.0.0
accept:                     application/vnd.linkedin.normalized+json+2.1
```

`li_at` is the login (~12-month TTL per `linkedin-toolkit`); `JSESSIONID` is the CSRF token
(~30-day TTL) and is a *derivation*, not a second secret. A browser is needed **only** to mint
those two values — `/feed/` must be loaded first, because that is what sets `JSESSIONID`.

**Contradiction found and resolved.** `linkedin-toolkit` §Q-CSRF-EXACT insists the header must
match the cookie *"byte-for-byte, including quotes"*; `linkedin-internal-api`, `linkedin-relay`
and `linkedin-api` all strip the quotes. Stripping works — every call in this session was a 200.
Treat the toolkit's claim as wrong, or at best not load-bearing.

**Do not cargo-cult headers.** `linkedin-relay` §Auth is right: the one primary source has
`x-li-track` *commented out*. An unjustified header is as likely to be a fingerprint mismatch as
a fix. `src/li-http.mjs` sends only the five above plus a current UA — and UA *freshness* is
itself a documented signal, with a reported case of a CHALLENGE clearing after a UA bump.

## 3. One request gets the profile

```
GET /voyager/api/identity/dash/profiles
    ?q=memberIdentity
    &memberIdentity=<publicId | bare ACoAA… id>       # NOT the full urn: (400)
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101
```

Verified live, 92 KB, `included[]` of 104 records:

| `$type` | n | gives us |
|---|---|---|
| `Profile` | 1 | name, publicIdentifier, headline, pictures, premium |
| `Position` / `PositionGroup` | 10 / 10 | experience with title, company, dateRange |
| `Skill` | 14 | skills |
| `Certification` | 3 | certifications |
| `Education` / `School` | 1 / 1 | education |
| `Company` | 10 | employer entities + logos |
| `Geo` | 6 | **the location string**, resolved |
| `Industry` | 6 | industry names |

Those counts are **identical** to what our 12-call `ProfileComponents` sweep produced. One
request replaces thirteen, and it also removes the profile-document fetch, the entire React
Flight decoder, and the member-id lookup — `memberIdentity` accepts the public slug directly.

`Geo urn:li:fsd_geo:102277331 → "San Francisco, California, United States"`, matching the
ground-truth file exactly. This closes the one gap `07-…` §10 left open, and it explains why the
earlier `voyagerDashGeo` probe failed: the geo never needed a separate call, it is already in
`included[]`.

**Correction on coverage (2026-08-30, after building it).** An earlier draft recorded
`summary` and the long-tail sections as *missing* from this decoration. That was wrong, and the
mistake is worth naming because it is the same one the bogus-`sectionType` control caught:
**an empty result was read as an absent capability.** The subject `Profile` record in fact
carries a collection reference for every section —

`*profileSkills` · `*profileCertifications` · `*profileEducations` · `*profilePositionGroups` ·
`*profileLanguages` · `*profileCourses` · `*profileProjects` · `*profileHonors` ·
`*profilePublications` · `*profilePatents` · `*profileOrganizations` ·
`*profileVolunteerExperiences` · `*profileTestScores`

— so one call is structurally capable of returning the whole profile. `summary` returned null
for the test profile because that member **has no About section** (confirmed against the
ground-truth file, where `about` is likewise null), not because the decoration omits it.

Honest limit: both profiles tested are empty in the long tail, so those collections are
**proven to resolve, not proven to populate**. Confirming them needs a member who has
languages/courses/organizations. `ProfileComponents` stays as the fallback path, no longer the
default one.

`FullProfile-76` (from `linkedin-mcp`, verified 2026-06-13) is the same finder with a smaller
recipe. Decoration ids carry a `-<n>` version suffix that rotates like a queryId hash.

## 4. Parsing rules, taken from the repos rather than rediscovered

**Q-NORMALIZED-RESOLVE / index-first.** `data` holds URN *references* (often under `*`-prefixed
keys); `included[]` is a flat unordered side-table. Build `Map<entityUrn, record>` in one pass,
then resolve. `linkedin-api` does an O(n·m) substring scan; `linkedin-relay` §4 explicitly says
not to re-derive that lesson.

**Q-POSITION-GRAPH-WALK — the correctness trap.** A `FullProfileWithEntities-101` response can
contain `Position` records belonging to *other* people cited in the response. Never filter
`included[]` globally by `$type == Position`. Walk the graph:

```
Profile.*profilePositionGroups → CollectionResponse.*elements
  → PositionGroup.*profilePositionInPositionGroup → CollectionResponse.*elements → Position
```

Same for `Q-MULTIPLE-PROFILES`: always take the subject from `data.*elements[0]`, never
`included.find($type === Profile)`.

**Q-ATTRIBUTED-TEXT.** Text is wrapped: `{text: "…", attributes: []}`. Unwrap recursively, and
skip `multiLocale*` keys or you get duplicates. This is the same shape as the `TextViewModel`
`.text.text` unwrapping we already hit in `src/sections.mjs`.

**Q-DATA-DOUBLE-WRAP.** Since 2026-04 GraphQL responses carry an extra `data` layer — the root
key is at `j.data.data.<rootKey>`. That is exactly the
`data.data.identityDashProfileComponentsBySectionType` path we found empirically; it is a
general rule, not a quirk of one query.

**Filter by exclusion, never by an accept-list.** `linkedin-relay` §4 records that an accept-list
cost its sibling project every reply in every thread and 34 of 77 posts per page — *invisibly*,
behind `ok: true`. Unknown `$type`s must pass through as data and be counted into a
`unknownTypes` field so drift is visible in the envelope.

**`fs_` vs `fsd_` drift.** `fs_miniProfile`, `fs_profile` and `fsd_profile` coexist mid-migration.
Collapse variants through one `canonicalUrn()`; read every field as `dash?.f ?? legacy?.f`.
Composite URNs (`urn:li:fs_updateV2:(<inner>,GROUP_FEED,…)`) need a real paren-aware parser —
the reference `split("(")[1].split(",")[0]` breaks on nesting, which occurs.

**Three-state resolution.** A URN referenced from `data` but missing from `included[]` is a
*failed decoration*, not "no data". `data` carrying references while `included` is empty is
schema drift, not an empty result. A genuine empty must be distinguishable from a lost one.

## 5. Rate limiting — replacing lore with the one empirical table

Our own observation stands: throttling is **silent**. HTTP 200, `section: null`, no GraphQL
error, no 429, no 999. It is shape-identical to an unknown `sectionType`, which is why the
bogus-name control mattered — a null proves nothing on its own.

The numbers in circulation are mostly SEO-blog lore (`~900 req/hr`, `~50 profile loads/day`)
with no methodology, and `linkedin-relay` §6 refuses to build thresholds on them. The one
*measured* table is `linkedin-toolkit` §13:

| operation | delay | sustained |
|---|---|---|
| paginated GETs | 0.4–0.5 s | 1500+ per session |
| profile fetches, single batch | 0.6 s | 50 |
| profile fetches, long batch | 1.0 s + 0–1.5 s jitter | 1700+ |

That is far more permissive than the lore — and it is another argument for §3, since one
decorated call per profile costs a *thirteenth* of the fan-out.

**Never retry into a throttle.** `linkedin-relay` breaks with its own sibling projects here and
is right: on LinkedIn a 429 is the warning shot on an escalation ladder
(warning → 1–3 week restriction → permanent ban), so retrying is the mechanism that converts a
warning into a restriction. Policy: `429` → stop, 1 h cooldown. `999` (a network-layer bot block)
→ 6 h. Challenge/checkpoint → indefinite, cleared only by a human logging in. Cooldown belongs in
a **file**, not process memory — a CLI is a swarm of short-lived processes.

**A 302 to the login wall means stale cookies, not detection.** `linkedin-internal-api` chased
this as suspected fingerprinting before finding the real cause. `src/li-http.mjs` raises on it.

**Pace reads as hard as writes.** Multiple restriction reports involve zero automation and zero
writes — fast *manual* browsing alone. A design that paces only writes is aimed at the wrong
threat.

## 6. Two things that will rot, and how to survive them

**queryId hashes are pinned to the deployed web-client build.** The client mints them at runtime
via `getGraphQLQueryId()` from `@linkedin/ember-restli-graphql`, resolved through
`window.require()` against the loaded webpack bundle — structurally identical to X's rotating
query hashes. Rotation cadence is unknown. Decoration ids rotate the same way through their
`-<n>` suffix. Consequence: **hashes are data, never literals in request logic.** Keep them in a
versioned contract carrying `provenance` and `capturedAt`, and let only `verified` entries reach
production. A 400 naming an unknown queryId is a *drift* signal, not a bug.

**Endpoints get retired.** `profileView` is the proof — a 410 that silently invalidates the most
popular client in the ecosystem. Classify the response *before* parsing it, so a 410/999/302 is
never fed to a parser that will report an empty profile.

## 7. Recommended architecture for the hosted API

```
Cloudflare Worker  (no browser, no Chrome, no CDP)
  ├── auth      li_at + JSESSIONID from secrets; csrf derived
  ├── classify  status → OK | AUTH_FAILED | RATE_LIMITED | DENIED | DRIFT   (before parse)
  ├── fetch     1 × dash/profiles FullProfileWithEntities-101
  │             + N × ProfileComponents ONLY for requested long-tail sections
  ├── parse     index included[] by entityUrn → graph-walk from data.*elements[0]
  └── respond   normalised JSON + meta{state, unknownTypes, unresolved, partial}
```

The browserless gate is **passed** — verified this session: `/voyager/api/me`, the 919 KB profile
document, and the 92 KB decorated aggregate all returned 200 from plain `fetch` with no browser
in the request path. Chrome is needed once, to mint cookies.

Never return an empty success. A genuine empty is `ok:true, items:[], state:'complete'`; auth
failure, throttling, drift, or `claimed > 0 && returned === 0` is `ok:false`.

## 8. What is still unproven

- **Long-tail population** — `languages`, `courses`, `projects`, `honors`, `publications`,
  `patents`, `organizations`, `volunteering`, `testScores` resolve to empty collections on both
  profiles tested, because both members genuinely have none. Proven to resolve; not yet proven
  to populate.
- **About/summary** — same status. Null on both test profiles, and correctly so; needs a member
  who has one.
- **`volunteer_experience` / `test-scores` `sectionType` names** — still unconfirmed on the
  GraphQL path, and *unconfirmable* against a profile lacking those sections. Now largely moot:
  the decoration exposes `*profileVolunteerExperiences` and `*profileTestScores` as typed
  references, so the long tail no longer depends on guessing enum spellings.
- **Restricted profiles** — untested. `Q-PROFILE-403-PER-PROFILE` warns a single 403 is
  profile-specific; only 5+ consecutive 403s indicate a session problem. `classify()` currently
  reports both as `AUTH_FAILED` and says so in the hint.

### Verified this session

| Claim | How |
|---|---|
| browserless reads work | `/me`, 919 KB document, 92 KB aggregate — all 200 from plain `fetch` |
| `profileView` is dead | 410 |
| one call replaces thirteen | counts identical to the 12-call sweep: Position 10, Skill 14, Cert 3, Edu 1 |
| geo resolves in-response | `102277331` → "San Francisco, California, United States", matching ground truth |
| populated profile | 10 experience entries, a strict superset of the 5-entry ground truth, none missing |
| sparse profile | owner's own profile: 21 records, correct core fields, empty arrays, no crash |
| unknown-type drift | zero unknown `$type`s on both profiles |
- **`li_at` lifetime and the minimal cookie set** — every source guesses; none isolates it.

## 9. Legal posture, recorded because it changes design

`linkedin-relay` §5 documents *LinkedIn v. Proxycurl* (N.D. Cal. 3:25-cv-00828, filed 2025-01-24,
settled; Proxycurl shut down). The operative points for a tool that uses the user's *own*
account: `hiQ v. LinkedIn` means scraping public logged-out data is not a CFAA violation, but it
explicitly does **not** immunise breach-of-contract once an account and its User Agreement are in
play — which is the theory that worked against Proxycurl. With an account in the loop the CFAA
question is moot and the **User Agreement is the entire exposure surface**, regardless of scale.
The Proxycurl founder's own conclusion is worth keeping in the repo verbatim:
**"Legal does not mean safe."**

Practical consequences already in force here: only the owner's account and session, `li_at` /
`JSESSIONID` never in chat or git, `captures/` gitignored, `.env` at 0600, no fan-out probing, no
automatic retry.
