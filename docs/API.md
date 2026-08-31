# API — LinkedIn's private Voyager API, as we found it

Everything verified live between 2026-08-30 and 08-31 against one account, cross-read against
eight reverse-engineering repos. `✅` executed here · `📖` documented elsewhere, not executed ·
`❓` unverified or contradicted.

---

## 0. How to use this file

`refs/` contains eight upstream reverse-engineering repos. **They already document the
mechanics well, and this file does not restate them.** What follows is: pointers to the best
existing source, the places where we contradict it and why, and the findings that exist in no
ref repo. §10 maps which repo is a snapshot of which client, so you know how far to trust each.

**Single best reference:** `refs/linkedin-toolkit/references/endpoints.md` — §1 auth, §10 the
profile call and its graph walk, §11 the named `Q-*` gotcha catalogue, §13 the only measured
rate table anywhere. Read that first; read this for what it gets wrong or lacks.

---

## 1. Auth — and the one place the reference is wrong

**Read:** `refs/linkedin-toolkit/references/endpoints.md` §1 · `refs/linkedin-internal-api/docs/01-AUTH-AND-COOKIES.md`

Two cookies (`li_at` = session, `JSESSIONID` = CSRF), `csrf-token` header, restli version, the
normalized `accept`. No browser is needed for the calls — it only mints the cookies, and
`/feed/` must be loaded because that is what sets `JSESSIONID`.

### ✅ Correction: strip the quotes

`linkedin-toolkit` §11 `Q-CSRF-EXACT` insists `csrf-token` must equal `JSESSIONID`
*"byte-for-byte, including any quotes"*. **That is wrong.** Every call in this project stripped
them and returned 200. Two independent confirmations:

- `linkedin-internal-api`, `linkedin-relay` and `linkedin-api` all strip them.
- **`linkedin-toolkit` contradicts itself** — its own §14 cookie-extraction regex strips the
  quotes that `Q-CSRF-EXACT` says to keep.

### ✅ Ours: the User-Agent is a property of the SESSION, not a constant

It must match the browser **and OS that minted the cookies**. Cookies minted in Chrome-on-Windows
presented with a macOS UA is a device mismatch on every request. Chrome's UA Reduction freezes
minor/build/patch to `0.0.0` and pins Windows to `NT 10.0` / macOS to `10_15_7`, so those
literals are correct rather than stale. Brave sends a **Chrome** UA — it does not identify
itself. No ref repo treats the UA as session-scoped; they all hardcode one.

### ✅ Ours: do not cargo-cult headers

`x-li-track` / `x-li-page-instance` / `x-li-deviceId` are **not** needed for Voyager reads. The
one primary source has `x-li-track` commented out. An unjustified header is as likely to be a
fingerprint mismatch as a fix.

---

## 2. Three generations of profile API ✅ ours

The refs contradict each other because each is a snapshot of a different generation (§10):

| generation | shape | status |
|---|---|---|
| `identity/profiles/{id}/profileView` | one monolithic JSON | ✅ **HTTP 410 — retired** |
| `identity/dash/profiles?q=memberIdentity&decorationId=…` | normalised `{data, included[]}` | ✅ **200 — use this** |
| `graphql voyagerIdentityDashProfileComponents` | SDUI render tree, one call per section | ✅ 200, long tail only |

> `profileView` returning 410 kills the profile path of `tomquirk/linkedin-api`, the
> most-starred client in the ecosystem — and the three repos that inherit from it. Verified by
> us; `linkedin-mcp` independently marks it `@deprecated … 410 (verified live 2026-06-13)`.

---

## 3. The one call

**Read:** `refs/linkedin-toolkit/references/endpoints.md` §10 — it documents this exact call,
the `{data, included[]}` shape, `Q-POSITION-GRAPH-WALK`, `Q-MULTIPLE-PROFILES` and the geo/date
handling. That section is correct and we add nothing to it.

```
GET /voyager/api/identity/dash/profiles
    ?q=memberIdentity&memberIdentity=<slug | bare ACoAA… id>   # full urn: → 400
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101
```

### ✅ Ours, on top of that section

- **`-101` and `-109` both work** — keep both as rotation fallbacks. `FullProfile-76` is a
  lighter live alternative (seen in real client traffic).
- **A decoration is a server-side FIELD RECIPE.** "Absent from this response" never means
  "Voyager cannot supply it" — §7 lists what other resources carry.
- ~92 KB / ~104 records on a populated profile. Collection refs on the subject `Profile`:

```
*profilePositionGroups *profileEducations *profileSkills *profileCertifications
*profileLanguages *profileCourses *profileProjects *profileHonors *profilePublications
*profilePatents *profileOrganizations *profileVolunteerExperiences *profileTestScores
*profileTreasuryMediaProfile   <- featured media; the ONLY collection seen `unresolved`
*profileVideoPreview           <- paging WITHOUT a `total` (see §5)
*profileRingStatusCollection   <- paging WITHOUT a `total` (see §5)
```

**Profile-level location** is NOT `locationName` — that is `null` on every fixture. Resolve
`geoLocation["*geo"]` in `included[]` → `Geo.defaultLocalizedName`. 📖 **Not our finding** —
`refs/linkedin-toolkit/references/endpoints.md:527` states this rule verbatim; it is repeated
here only because omitting it caused a rebuild to emit `null` for every profile's location
("San Francisco, California, United States"). `location.countryCode` is separate.
(Position-level location IS `Position.locationName`, and is absent on some positions.)

```
```

- **`photoFilterType`** is the photo *editing* filter, NOT a badge. Observed values across nine
  profiles: `ORIGINAL`, `STUDIO`, `None`.
  ⚠️ **Exact path: `profilePicture.photoFilterEditInfo.photoFilterType`.** It is NOT on
  `profilePicture` directly — verified null there on every fixture. The wrong path reads
  `undefined` and never errors.
  ⚠️ **DISPROVEN 2026-08-31 — this file previously claimed `photoFilterType` carries the
  `#OpenToWork` / `#Hiring` banners.** It does not. Two profiles verified to display those frames
  both returned `photoFilterType: "ORIGINAL"`, so a test against it can never fire and every
  profile received a confident `false` — the API asserting "not open to work" about people who
  are. Searching every saved payload for `openToWork`, `jobSeeker`, `memberBadges`, `photoFrame`
  and `frameType` returns zero hits, while `showPremiumSubscriberBadge` and
  `shouldShowSourceOfHireBadge` ARE present: the badge namespace exists in this decoration and
  simply has no open-to-work member. The `isOpenToWork` / `isHiring` fields were removed rather
  than left emitting a permanent null. Do not reintroduce them from this field.
- **`urn:li:fsd_memberRelationship:<profileId>`** → `memberRelationshipUnion.<branch>.memberDistance`
  gives connection degree in the same response — **when present. It is absent on 3 of 5 fixtures**, so treat null as "not supplied", never as "out of network". `enrich=social` supplies it more reliably via `normalizedProfiles.distance`. ⚠️ A response also carries
  `MemberRelationship` records for *other* people (7 of 8 on one fixture) — an unwarned sibling
  of `Q-MULTIPLE-PROFILES`. Key on the subject's own id.

---

## 4. Parsing

**Read:** `refs/linkedin-toolkit/references/endpoints.md` §11 — the named `Q-*` catalogue
(`Q-NORMALIZED-RESOLVE`, `Q-POSITION-GRAPH-WALK`, `Q-MULTIPLE-PROFILES`, `Q-ATTRIBUTED-TEXT`,
`Q-DATA-DOUBLE-WRAP`, `Q-VARIABLES-ENCODING`, `Q-MEMBERIDENTITY-NO-FULL-URN`,
`Q-PROFILE-403-PER-PROFILE`). All correct, all still apply. Do not re-derive them.

One addition of ours: **components live in `included[]`, not under the section root.** Walking
only `data.data.<root>` returns **zero** entities — the same normalized-resolve pattern, but it
catches people out on the components surface specifically.

### ✅ Ours: field shapes that bit us

Verified by grep against `refs/`. **Genuinely absent there** (0 hits): `positionHeld`,
`NATIVE_OR_BILINGUAL`, `photoFilterType`, `memberDistance`, `pagedListComponent`, `VIEW_DETAILS`.

⚠️ **Two entries below are NOT ours** and are kept only because the exact trap is undocumented:
`Company.universalName` is in `linkedin-mcp/src/types.ts` and `linkedin-api/linkedin_api/linkedin.py`
(16 files in `refs/` mention it), and the `vectorImage` rootUrl + widest-artifact rule is in
`linkedin-mcp/src/browser/normalize.ts`. An earlier version of this file claimed the whole block
was novel — an over-broad "verified by grep" is exactly the failure this wrapper format exists to
prevent.

```
Organization.positionHeld        NOT `position` — the wrong name yields silent nulls
Language.proficiency             an ENUM ("NATIVE_OR_BILINGUAL"), not the UI string
Course.number                    the course code, e.g. "FIN 374C"
Position.locationName            ABSENT on some positions — sampling ONE record to infer
                                 the schema is how this was missed
occupation["*profileEducation"]  → Education.schoolName = institution for courses/orgs
Company.url                      the LinkedIn PAGE, not the company website
Company.universalName            the slug  (📖 in refs — not our finding)
Company.industry                 { "*urn:li:fsd_industry:43": "urn:…" } — take the VALUE
images  (📖 vectorImage rule is in refs; the DUAL SHAPE below is ours)
                                 displayImageReference | displayImage, and either
                                 {vectorImage: rootUrl + widest artifact} OR a plain {url}
                                 (LinkedIn defaults). Handling only the first returns null
                                 for anyone using a default image.
company detail                   spread across SEVERAL records — a Company (name, description)
                                 and an OrganizationalPage-shaped one (websiteUrl, foundedOn).
                                 Merge every record matching the slug; selecting one loses data.
```

---

## 5. Collections are capped, silently

Every collection resolves to a `CollectionResponse` whose **shape tells you which state it is in**:

| state | rule | note |
|---|---|---|
| genuinely empty | `paging.total === 0` | |
| complete | `total === returned` | |
| **truncated** | `total > returned` **and** `returned >= paging.count` (the cap) | more exist → paginate |
| **unresolved** | `total > returned` **and** `returned < cap` | **failed decoration**, not "no data" |

⚠️ **Two collections carry `paging` with NO `total`** — `*profileVideoPreview` and
`*profileRingStatusCollection`, present on all five fixtures. They match no row above; treat a
missing `total` as **`unknown`** and skip them rather than assigning a state.

⚠️ **Where a `total` exists, it is the ONLY discriminator.** An earlier version of this table claimed the
`*elements` (starred) vs `elements` (unstarred) key told you whether a collection was empty.
**That is wrong**, and this project's own fixture disproves it: unresolved-media's
`*profileTreasuryMediaProfile` is unstarred `"elements": []` with `paging.total: 10` — i.e. ten
records exist and none were returned. The star only indicates whether members arrived as URN
references; it says nothing about emptiness. A parser built on the star ships a broken
`unresolved` detector.

**`paging.count` IS the cap, and it is in every `CollectionResponse`** — read it rather than
hardcoding. The "10 for position groups, 20 for most others" figures below are what it happens to
contain today, not constants.

⚠️ A ref will tell you not to: `refs/linkedin-internal-api/docs/27-JOBS.md` states as a hard rule
that `paging.count` must never be read because "it echoes the page size *we* sent". That is true
for the jobs-search route it describes and **wrong here** — profile collections are not paged by
us. A dated snapshot, correct in its own context, harmful in this one.

⚠️ Caps: **10** for `*profilePositionGroups`, **20** for most others. Nothing in the payload says
"truncated" — compare `paging.total` against what arrived or you return a partial profile as a
complete one. Note the cap is on position **groups**, not roles: 7 groups can yield 10 positions.

### Pagination — solved ✅

```
GET /voyager/api/graphql
    ?queryId=voyagerIdentityDashProfileComponents.942ee340539e7b43ee193df3d6ec4be2
    &variables=(pagedListComponent:<ENCODED_URN>,start:10,count:10)
```

⚠️ The variable is **`pagedListComponent`**, NOT `pagedListComponentUrn` despite the query being
named `…ByPagedListComponentUrn`. Wrong name → HTTP **200** carrying
`data.errors[].message: "Variable 'pagedListComponent' has coerced Null value…"` — read the body,
the error names what it wants.

**The URN is CONSTRUCTIBLE — no discovery call needed:**
```
urn:li:fsd_profilePagedListComponent:(<memberId>,<SECTION>_VIEW_DETAILS,<scope>,NONE,en_US)
  scope = urn:li:fsd_profile:<memberId>              (experience, education, most)
        = urn:li:fsd_profileTabSection:ALL_SKILLS    (skills)
```
Sections seen: `EXPERIENCE EDUCATION SKILLS COURSES LANGUAGES HONORS_AND_AWARDS
LICENSES_AND_CERTIFICATIONS ORGANIZATIONS INTERESTS` (each `_VIEW_DETAILS`).

✅ Verified: experience `start:10,count:10` returned exactly the 2 roles missing from a
truncated first page. **No reference repo implements this.**

---

## 6. Rest.li grammar

**Read:** `refs/linkedin-relay/docs/research/R3-linkedin-surface.md` §2 — the fullest write-up
of the `variables=(…)` literal syntax: `(k:v,k2:v2)` = object, `List(a,b)` = array, `a | b` = OR,
arbitrary nesting. Also `linkedin-toolkit` §11 `Q-VARIABLES-ENCODING`.

The one thing worth repeating because it silently 400s: structural `( ) : ,` stay **raw**, but
the same characters **inside a value** must be percent-encoded. JS `encodeURIComponent` leaves
`(` and `)` alone, so encode them explicitly:

```js
encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29')
```

### ✅ Ours: read the error body

LinkedIn's GraphQL errors **name the variable they want**. Two problems were solved this way
after guessing had failed:

```
Variable 'pagedListComponent' has coerced Null value for NonNull type 'String!'
Variable 'viewerPermissions' … Expected type 'Map' but was 'String'
```

A 200 can also carry `data.errors` — the status code lies. Always parse the body.

## 7. Other resources (what the decoration does not carry)

| want | where |
|---|---|
| follower count, connection distance, badges, contact | `identity/normalizedProfiles/<id>` → keys include `distance`, `*followingInfo`, `*badges`, `confirmedEmailAddresses`, `confirmedPhoneNumbers` ✅ 200 observed, body never saved |
| interests, skill endorsements | `ProfileComponents` `sectionType:interests` / `skills` ✅ 23 rows / 14 skills parsed |
| connection **count** (e.g. "500+") | only the **rendered document** — display text, not an API field ⚠️ 999-blocked from datacenter IPs |
| company website | `voyagerOrganizationDashCompanies`, +1 per company |
| contact info | legacy REST is **410**; `ProfileContactInfoById` = `8aa5843dfcd1e81a06db3a87fb2e0c20` (Android catalogue) 📖 never called |

---

## 8. Android queryIds work on the web transport — with a caveat

A `queryId` is a **server-side persisted-query id**, not a client credential. `/voyager/api/` is
one backend, so any registered hash resolves for any caller. But the hash identifies a **field
selection**, and web and Android select different fields:

| | web | Android |
|---|---|---|
| `ProfileComponentsBySectionType` | `86824295e1093fb0f5acdd8d57213aaa` | `ab68d8cbfe2835a1f1e2ac6c2646c2c0` |
| required `accept` | `…normalized+json+2.1` | `application/json` |
| response | `{data, included[]}` | `{data}` — **inlined, no side-table** |

✅ Measured, same hash, only `accept` changed: web accept → **HTTP 500**
`"A record in the included list does not have a type… logoResolutionResult"`; Android accept →
**200**. The 500 is not hash rejection — the query ran and the *web serializer* could not type an
Android-shaped record.

Compatibility is **per-hash**: `942ee340…` (pagination) is APK-derived and works under the web
accept. **Take the strings, not the fingerprint** — never copy Android's UA/`x-li-track`, which
would contradict a browser-minted cookie. `accept` is content negotiation, not identity.

Why it matters: web queryIds must be captured from live logged-in traffic one at a time; the APK
ships all 481 statically. Decompile once — the cheapest answer to hash rotation.

---

## 9. queryIds and decorations rot

The web client mints queryIds at runtime via `getGraphQLQueryId()` against its webpack bundle, so
they are **pinned to LinkedIn's deployed build**. Decoration `-<n>` suffixes rotate the same way.
Cadence unknown.

⇒ Hashes are **config with provenance + capturedAt**, never literals in request logic. A 400
naming an unknown decoration is a *drift signal*, not a bug. `profileView`'s 410 is the
cautionary tale: it silently invalidated the ecosystem's most popular client.

---

## 10. Which repo is a snapshot of which client

The eight reference repos disagree with each other constantly. They are not wrong so much as
**snapshots of different clients at different dates**, and knowing which is which turns a
contradiction into a date-stamp.

LinkedIn has four surfaces in play:

| surface | shape | notes |
|---|---|---|
| **legacy REST** `identity/profiles/…` | inline `decoration=(field,field,…)` | being retired — `profileView` is **410** |
| **dash REST** `identity/dash/profiles?q=…` | named `decorationId=…-<n>` | current; what we use |
| **dash GraphQL** `graphql?queryId=<name>.<32hex>` | persisted queries, hash rotates | current; sections, pagination, company |
| **SDUI** `/flagship-web/rsc-action/…` | protobuf-JSON, page-bound headers | newer UI areas; not requests-friendly |

| repo | derived from | client | dated | what it is good for | where it misleads |
|---|---|---|---|---|---|
| **linkedin-cli** | **Android APK v4.1.1209, decompiled** | Android | 2026 | 481 queryIds **statically** — names + hashes, no session needed | hashes are Android field selections: some need `accept: application/json` (§8). Its UA impersonates a Galaxy S22 |
| **linkedin-internal-api** | live web capture (CDP crawler + click-and-record) | web | 2026-07 | 130 endpoints, the auth model, honest verified/inferred labels (the `Q-*` catalogue is **linkedin-toolkit's**, not this repo's) | write-heavy; its read docs assume the SDUI/section route |
| **linkedin-mcp** | live web capture | web | verified 2026-06-13 | `dash/profiles` finders, `FullProfile-76`, TS types (`websiteUrl`, `followerCount`) | labels `148b1aeb…` as "company" — it is actually **guide-entry-points** |
| **linkedin-toolkit** | web, browser + headless modes | web | 2026-04-25 | **the only measured rate-limit table** (§ LEARNED-02) | claims `csrf-token` must keep its quotes — contradicted by every call we made |
| **linkedin-api** (tomquirk) | legacy web REST | web **legacy** | PyPI 2.3.1, **Nov 2024** | the inline-`decoration` syntax; the Rest.li variables grammar | its entire profile path is **410**. Four repos inherit from it |
| **linkedin-relay** | design doc **plus a released CLI (v3.0.3)** | web | 2026-08 | the best written analysis of the surface, rate limits and legal exposure; its README already states the zero-retry / cooldown-as-a-file design we arrived at independently | earlier drafts of these docs called it "research only, never built" — **wrong**, it ships code |
| **linkedin_scraper** | Selenium DOM scraping | browser DOM | — | — | not API-based at all; skimmed only |
| **linkedin-voyager_api** | Ruby, legacy Voyager | web **legacy** | — | — | same legacy generation as `linkedin-api`; skimmed only |

> Honest note: the first six were read in depth. `linkedin_scraper` and `linkedin-voyager_api`
> were skimmed — their generation is inferred from structure, not audited.

### How to use this

- **Need a queryId?** `linkedin-cli` (static, no session) → then check `accept` per §8.
- **Need to know if a route still works?** Check the *date*. Anything tracing to `linkedin-api`
  is a Nov-2024 legacy snapshot and probably 410.
- **Need parsing behaviour?** `linkedin-internal-api`'s `Q-*` catalogue, cross-checked against
  `linkedin-mcp`'s TypeScript types.
- **Need numbers?** Only `linkedin-toolkit` §13 measured anything. Everything else is lore.
- **Two repos disagree?** The later web capture usually wins — but verify, because a *name* can
  be wrong in a live capture too (`148b1aeb…` was captured correctly and labelled wrongly).

**The route none of them use:** the web client's own JS bundle registers every query as
`{kind:"query", id:"<resource>.<32hex>", name:"<slug>"}`. That is 933 queries with
human-readable names, from `static.licdn.com`, with **no cookies and no API calls** — strictly
better than both traffic capture and APK decompilation for *finding* a hash.
