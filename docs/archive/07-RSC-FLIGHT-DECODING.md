# 07 — The profile payload is a React Flight stream in the document

> **Status (updated 2026-08-31).** Superseded as the primary path, but NOT worthless:
> the Flight decoder is still the only way to read follower/connection counts, which are
> display text on the rendered top card and exist in no API decoration (`enrich=counts`).
> Two corrections to what follows: (a) §11b overstated the datacenter finding — a 302
> self-redirect means the SESSION is invalid, not that the IP is blocked; unauthenticated
> calls from Cloudflare are served normally. (b) The profile DOCUMENT surface *is*
> 999-blocked from datacenter IPs, which makes this path **unhostable** on Cloudflare and
> is a large part of why the API runs on a laptop.
> Current position: [README.md](../../README.md)


Date: 2026-08-30. Supersedes the transport assumption in
[06-CORRECTIONS-AND-CONFIRMED-LIVE-FINDINGS.md](06-CORRECTIONS-AND-CONFIRMED-LIVE-FINDINGS.md)
and §10 of [../TRANSFER.md](TRANSFER.md).

All findings below come from one authenticated capture of a single profile
(`/in/complete-at-cap/`) in the user's own Chrome session. Raw captures stay in the
gitignored `captures/` directory.

## 1. Correction: the RSC POSTs are not the profile transport

The previous handoff concluded that `/flagship-web/rsc-action/actions/component`
carries the viewed profile. The live capture contradicts that:

| Request | Bytes | Profile cards it carries |
| --- | --- | --- |
| `profileCardsAboveActivity` | 20,233 | About, Featured, Services, SuggestedForYou, SalesInsightsOrHighlights — **as lazy placeholders** |
| `profileCardsActivity` | 5,828,622 | Activity feed posts only |
| `app-config` | 1,032,424 | No profile data |

**The Topcard appears in no POST response at all.** Neither does Experience or
Education. `profileCardsAboveActivity` is 20 KB because it is mostly
`ReplaceableComponent` shells plus `AsyncComponentRequest` descriptors.

Voyager is likewise not the source. The `/voyager/api/graphql` calls in this page
load served notifications, messaging and viewer initialisation — consistent with
§9.1 of the handoff, and still not a profile read.

## 2. Where the profile actually lives

An authenticated `GET https://www.linkedin.com/in/<handle>/` returns ~920 KB of
HTML. Inside it, one `<script>` assigns:

```js
window.__como_rehydration__ = [ "1:I[\"64c7816b…\",[],\"default\"]\n2:I[…", … ]
```

152 string chunks. Concatenated they form a **748 KB React Flight (RSC) stream**:
364 rows, 297 of them serialized component trees, 64 module imports.

This is the same wire format the `rsc-action` POSTs return — but delivered inline,
in the initial document, in a single request.

### Why this matters

The architecture question in §13 of the handoff largely answers itself. One
authenticated GET yields the structured profile tree, with no browser execution
required to obtain it. That is Worker-compatible in a way that replaying
page-bound `rsc-action` POSTs is not.

Not yet proven: whether that GET succeeds from outside a browser with only cookie
headers. That is the next gate — see §6.

## 3. Flight stream grammar (as observed)

```text
<hexId>:I["<moduleHash>",[],"<exportName>"]   module import row
<hexId>:[ … ]                                 value row, usually an element tree
["$", type, key, props]                       element tuple
"$Lxx"                                        reference to row xx
"$undefined"                                  undefined
```

Element `type` is either an HTML tag (`"div"`, `"h2"`, `"p"`, `"img"`) or `"$Lxx"`
naming a component from an import row. Rows reference each other freely, so a
decoder needs memoisation and a cycle guard; `src/flight.mjs` has both.

Worked example — row 45, the Topcard:

```json
["$","div",null,{"data-component-type":"LazyColumn","children":[…
  ["$","$L35",null,{"observabilityIdentifier":"com.linkedin.sdui.impl.profile.components.topCard",
    "children":["$","$L2c",null,{"componentKey":"com.linkedin.sdui.profile.card.ref<ID>Topcard",
      "children":["$","$L46","…Topcard",{"initialContent":"$L6a", …
```

Note `initialContent: "$L6a"` — card content hangs off a prop that is not
`children`, so a naive children-only walk returns an empty Topcard. This cost a
debugging cycle and is why `textOf` in `src/flight.mjs` walks all props except a
denylist.

## 4. Parsing anchors

Two semantic anchors, neither of which is a hashed CSS class:

- **Cards** — a `componentKey` prop matching
  `com.linkedin.sdui.profile.card.ref<PROFILE_ID><SectionName>`.
- **Text runs** — any node whose props contain `fontFamily`. Every human-readable
  string on the page is inside one. Verified against name, pronouns, headline,
  location and connection count.

Secondary: `observabilityIdentifier` (e.g.
`com.linkedin.sdui.impl.profile.components.topCard`) and testid-like strings
(`profile-top-card`, `profile-top-card-member-photo`, `profile-premium-badge`).

Card refs are keyed by the **non-iterable profile ID** (`ACoAA…`) except the
Activity card, which is keyed by the **vanity name**. Both appear on one page, so
a parser must accept either.

## 5. Fields recovered from the Topcard

Decoded from the capture via `src/flight.mjs`:

| Challenge field | Recovered | Source |
| --- | --- | --- |
| name | yes | `h2` element and a `fontFamily` run |
| public identifier | yes | vanity name, throughout card refs and URLs |
| headline | yes | `fontFamily` run after the name |
| location | yes | `fontFamily` run |
| profile image | yes | 4 renditions: 100/200/400 scaled, 800 cropped |
| cover image | yes | `profile-displaybackgroundimage` URL |
| pronouns | yes (bonus) | `fontFamily` run after name |
| current company | yes (bonus) | `fontFamily` run |
| connection count | yes (bonus) | `"500+"` run |
| contact info | link only | `/in/<handle>/overlay/contact-info/` — needs a second fetch |
| about, experience, education, skills, certifications, languages | **not present for this profile** | see §7 |

Two incidental observations worth recording: the Topcard tree also embeds the
**viewer's** vanity name, and image URLs carry expiring `e=`/`t=` signature
parameters, so they must be treated as short-lived.

## 6. Open gates

1. **Browserless GET.** Does `GET /in/<handle>/` return the same rehydration
   payload to a plain HTTP client with `li_at` + `JSESSIONID` and no browser? If
   yes, the Worker path is viable and §13's "browserless" option wins outright.
   If LinkedIn gates the payload on page-bound headers or a JS challenge, we fall
   back to hybrid.
2. **Populated profile.** `complete-at-cap` has no Experience/Education/Skills cards
   at all — confirmed after a twelve-step full-page scroll. It is a good *sparse*
   fixture but cannot map the sections the challenge grades. A populated target is
   required before the field map can be completed.
3. **Details sub-pages.** Whether `/in/<handle>/details/experience/` serves its own
   rehydration payload is untested and would be the cleanest per-section source.
4. **Row-ID stability.** Row 45 held the Topcard in this capture. Row numbers are
   almost certainly per-render and must never be hardcoded — resolve from row `0`
   and search by `componentKey`.
5. **Locale and deployment drift.** Card names and module hashes are unversioned.

## 7. Why this profile has no experience section

Ruled out: lazy mounting. A twelve-step scroll with a settle delay produced the
same eight card refs (Topcard, SalesInsightsOrHighlights, SuggestedForYou, About,
Services, Featured, Activity, SupportedLocales). The rendered `main` text goes
Topcard → Featured → Activity → recommendations with no gap.

The remaining explanations are that the profile owner has no such entries, or has
restricted them from out-of-network viewers. The capture was made as a 3rd-degree
connection, so viewer-degree effects cannot be excluded from a single sample. This
is exactly why §12.7 of the handoff calls for three profile shapes.

## 8. Tooling added

| File | Purpose |
| --- | --- |
| `cdp.mjs` | Minimal CDP client against the already-running Chrome on 127.0.0.1:9222. Never launches a browser. |
| `capture-rsc.mjs` | Reload one profile, save all rsc-action + voyager request/response pairs to `captures/<timestamp>/`. |
| `fetch-doc.mjs` | In-session fetch of the profile document, saved whole. |
| `src/flight.mjs` | Flight row parser, `$L` resolver with cycle guard, tree walker, card finder, text extractor. |
| `decode.mjs` | CLI: decode a captured document or RSC response and list its cards. |

The Chrome DevTools MCP was abandoned for capture work: it truncates response
bodies at ~10,000 characters and had attached to a different Chrome instance than
the user's authenticated one. Raw CDP has neither limitation — it retrieved a
5.8 MB response body intact.

Request bodies in `captures/` contain tracking cookie values. `captures/` is
gitignored and must stay that way.

---

## 9. The sections come from Voyager after all (2026-08-30, later)

Two corrections to §5–7 above, both found by following
`refs/linkedin-internal-api` rather than the live page.

### 9.1 `complete-at-cap` does have an Experience section

§7 concluded the profile had none. That was wrong. The sections are absent from
the *main* profile page for this session, but `/in/complete-at-cap/details/experience/`
renders ten roles. The main-page absence is real and still unexplained — the
profile card container is a `LazyColumn` with `paginationNeeded: true`, and the
Activity feed nested inside it is infinite, so a scroll-driven load may never
reach the column's next page. Not proven, and not worth proving: the details
route makes it moot.

Note the details pages carry their content as **plain server-rendered HTML**. Their
`__como_rehydration__` payload holds only i18n strings. Different route, different
parsing path.

### 9.2 The real find: `voyagerIdentityDashProfileComponents`

`docs/02-VOYAGER-API.md:23` in the internal-api repo names a query ID we had not
tried. Live against the target:

```text
GET /voyager/api/graphql
  ?variables=(profileUrn:urn%3Ali%3Afsd_profile%3A<ID>,sectionType:<SECTION>,locale:en_US)
  &queryId=voyagerIdentityDashProfileComponents.86824295e1093fb0f5acdd8d57213aaa
```

Standard Voyager headers (`csrf-token` from the `JSESSIONID` cookie,
`x-restli-protocol-version: 2.0.0`, normalized-JSON accept). Twelve section types
return live data:

| sectionType | Result |
| --- | --- |
| `experience` | 73 KB, 10 roles |
| `skills` | 87 KB, 14 skills |
| `certifications` | 25 KB, 3 |
| `education` | 8.7 KB, 1 |
| `interests` | 226 KB, 23 |
| `languages`, `courses`, `projects`, `honors`, `organizations`, `publications`, `patents` | valid, empty for this profile |
| `volunteering_experience`, `test_scores`, `recommendations` | GraphQL error — wrong section name, not yet found |

This is ordinary normalized JSON. No Flight decoding, no HTML scraping, no browser
rendering. It supersedes the RSC path for everything except the top card.

### 9.3 Section entity schema

Every section type uses one `entityComponent` shape, which is why one parser
covers all twelve:

| Slot | Holds | Example |
| --- | --- | --- |
| `titleV2` | primary line | `"Founding Engineer"` |
| `subtitle` | secondary | `"BharatX · Full-time"` |
| `caption` | dates | `"2024 - 2024 · Less than a year"` |
| `metadata` | location | `"Bengaluru, Karnataka, India · On-site"` |
| `subComponents` | description, bullets, nested roles | `"Working on backend, risk underwriting…"` |

Each slot is a `TextComponent` wrapping a `TextViewModel`, so the readable string
is at `slot.text.text` — some slots hold the `TextViewModel` directly, so the
unwrap must handle both. Entities nest for multi-role-at-one-company. Skills
appear twice (a paged list and a fixed "top skills" list) and need de-duplicating.

`src/sections.mjs` implements this; `parse-sections.mjs` prints it.

### 9.4 Validated against ground truth

Compared with a hand-checked JSON of the same profile:

| Section | Hand-checked | Ours |
| --- | --- | --- |
| experience | 5 | **10** |
| certifications | 2 | **3** |
| skills | 2 | **14** |
| education | 1 | 1 |

Ours is the superset because the hand-checked file was taken from the visible page,
which truncates behind "Show all". The hand-checked file also puts the description
`"Everything"` into `location`; the API keeps those slots distinct.

### 9.5 Rate limiting is real and arrives quietly

After roughly thirty section reads in one session, the same query began returning
**HTTP 200 with `identityDashProfileComponentsBySectionType: null` and a GraphQL
error** — not 429, not 999. Any client must treat a null section with an error
array as throttling, not as an empty profile, or it will silently emit blank
profiles under load. Probing stopped at that point.

### 9.6 Revised architecture

```text
profile URL
    |
    +-- GET /in/<handle>/ ............. Flight stream -> top card
    |                                   (name, headline, location, pronouns,
    |                                    images, connections)
    |
    +-- GET /voyager/api/graphql ...... normalized JSON -> 12 sections
        (once per sectionType)          (experience, education, skills, …)
```

Both are plain authenticated GETs. Neither needs a browser to *render*, only to
supply a session — which is what makes the Worker path plausible. The untested gate
from §6.1 stands: whether these succeed from a non-browser client with only
`li_at` + `JSESSIONID`.

### 9.7 Known gaps in `profile.mjs`

The section half is solid. The top-card half is not yet reliable: on some renders
the Topcard content is not reachable from Flight row `0`, and the all-rows fallback
did not recover it either, so `name`/`headline`/`location` currently come back null
while images (scraped from the raw document) succeed. The saved capture parses
correctly with the same code, so this is a render-variant problem, not a decoder
bug. Fixing it needs a fresh capture — blocked until the rate limit clears.

---

## 10. Correction: no browser is needed at all (2026-08-30)

Sections 1–9 drive the reads through CDP inside the logged-in browser. That was never
necessary, and `refs/linkedin-internal-api/docs/01-AUTH-AND-COOKIES.md` says so plainly.
The reads run over plain HTTPS with two cookies.

### What actually authenticates a read

| Cookie | Role |
|---|---|
| `li_at` | the session token — the actual login |
| `JSESSIONID` | the CSRF token; sent **also** as the `csrf-token` header, quotes stripped, `ajax:` prefix kept |

Plus `x-restli-protocol-version: 2.0.0` and
`accept: application/vnd.linkedin.normalized+json+2.1`. Nothing else is load-bearing.

> **The 302 trap.** A read that redirects to the login wall means the cookies are **stale**,
> not that the client was fingerprinted. The reference repo chased this as suspected bot
> detection before finding the real cause. `src/li-http.mjs` therefore raises on a 302 rather
> than parsing an auth wall into empty fields — a silent empty profile is the worse failure.

This is the viability gate for hosting the API on a Cloudflare Worker, and it is **passed**:
verified live, `GET /voyager/api/me` → 200 and the full 919 KB profile document → 200, both
from Node's `fetch` with no browser running the request. The browser is now needed **only** to
harvest the two cookies.

### The top card does not need the Flight stream either

Decoding `window.__como_rehydration__` yields the top card only as loose text runs, interleaved
with contact-info modal copy and premium upsell strings. Selecting fields from them is
positional guesswork — successive heuristics picked the contact-info modal, then a
"1-month free trial…" upsell, as the headline.

`GET /voyager/api/identity/dash/profiles/urn:li:fsd_profile:<ID>` returns the same values as
**named fields** (`firstName`, `lastName`, `headline`, `publicIdentifier`, `premium`,
`profilePicture`, `backgroundPicture`, `location.countryCode`). Its headline matches the
ground-truth file byte for byte. `identity/normalizedProfiles/<ID>` is a second structured
view, adding `location.locationDisplayName` and `mostRecentPosition`.

Images arrive as a `vectorImage`: concatenate `rootUrl` with the
`fileIdentifyingUrlPathSegment` of the widest artifact.

**The one field still taken from the document** is the displayed location string
("San Francisco, California, United States"). `dash/profiles` carries only a `geoUrn`, and
`normalizedProfiles` gives the broader "San Francisco Bay Area". Resolving the geo URN through
`voyagerDashGeo` returned an unrelated city, so the variable name is wrong and was not worth
guessing further. `voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a`
— catalogued as "Profile (top-card variant)" in `23-READ-DISCOVERY.md` — is the untested
candidate that would remove the last document fetch.

### Unknown section names fail silently — a control test

`sectionType` is **not** documented in any of the eight reference repos; the enumeration in
`profile.mjs` is our own. That matters because of how a bad name behaves:

| Request | HTTP | section | GraphQL error |
|---|---|---|---|
| `sectionType:experience` | 200 | populated (73 KB) | none |
| `sectionType:volunteer_experience` | 200 | `null` (547 B) | none |
| `sectionType:totally_bogus_section` | 200 | `null` (548 B) | none |

A deliberately invented name is **indistinguishable** from a real-but-empty section. So a null
response is *not* evidence that a name is valid, and `volunteer_experience` / `test-scores`
remain **unconfirmed** — the docs give them only as SDUI *pager* names
(`com.linkedin.sdui.pagers.profile.details.volunteer_experience`), which is a different
namespace. Confirming them needs a profile that actually has that section populated.

This also retracts the earlier claim that those three sections "errored": they do not error,
and the errors seen previously were throttling, not name rejection.

### Throttling, restated

The silent-null failure mode is the same shape as an unknown section name, which makes the two
easy to confuse. During this session a full 12-section sweep succeeded at 19:26–19:27 and the
identical sweep returned no usable sections two minutes later. A production client must treat
`200 + null + no error` as *retry later*, not as *empty section*, and must not re-probe to
find out which — the only safe discriminator is a section known to be populated for that member.
