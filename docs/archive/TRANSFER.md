# LinkedIn Profile API reverse-engineering transfer document

Last updated: 2026-08-30

> **Superseded in part.** Sections 10-13 assume the `rsc-action` POSTs carry the viewed
> profile. Live capture on 2026-08-30 disproved that: the profile arrives as a React Flight
> stream embedded in the profile document itself (`window.__como_rehydration__`). See
> [docs/07-RSC-FLIGHT-DECODING.md](07-RSC-FLIGHT-DECODING.md) for the current transport
> model, the stream grammar, and the working decoder.

This is the complete handoff for the LinkedIn profile-scraper investigation so far. It explains the
challenge, what the reference repositories told us, what was tested locally, the mistakes that were
corrected, the live backend architecture observed through Chrome, and exactly what remains to be done.

## 1. The challenge

The hiring challenge is to build a hosted HTTPS API similar to PhantomBuster's LinkedIn Profile
Scraper. The API must accept a LinkedIn profile URL and return structured JSON containing as much of
the visible profile as possible:

- name and public identifier
- headline
- location
- about/summary
- experience
- education
- skills
- certifications
- languages
- profile and cover images when available

The submission also needs a public GitHub repository, a README with setup/API/approach/limitations,
and no credentials committed to the repository.

The agreed working order is deliberately local and explanatory first. No hosted API has been built,
and no Cloudflare Worker implementation has been started. The current work is reverse-engineering and
evidence collection.

## 2. Safety and scope

Only an account and browser session controlled by the user are in scope. The assistant has not made
unauthenticated or arbitrary LinkedIn requests. Browser observations were made against one profile in
the user's logged-in Chrome session.

Credentials must remain local. In particular:

- `li_at` and `JSESSIONID` must never be pasted into chat or committed.
- CSRF values, complete internal member IDs, raw request headers, and raw captures should remain local.
- A raw profile response is personal data even when the profile is publicly viewable.
- Do not automatically retry, guess alternate query hashes, or fan out to every possible section.
- Stop on `429` or `999` responses.

The browser connector briefly exposed an unrelated Gmail tab title while listing pages. It was not
opened or inspected, and the user was asked to keep unrelated tabs closed. The current Chrome page list
was later reduced to the LinkedIn profile tab.

## 3. Reference repositories supplied by the user

The initial five references were:

1. `mguttmann/linkedin-internal-api`
2. `vicnaum/linkedin-toolkit`
3. `alabarga/linkedin-api`
4. `joeyism/linkedin_scraper`
5. `marostr/linkedin-voyager_api`

### 3.1 `mguttmann/linkedin-internal-api`

This is the strongest general reference. It documents authenticated Voyager requests, cookie/CSRF
handling, capture methodology, endpoint inventories, and a second SDUI/RSC backend world. It says the
website talks to two private API families:

```text
Voyager: /voyager/api/...
SDUI:    /flagship-web/rsc-action/...
```

It contains a browserless-first client and MCP server, but browserless does not mean unauthenticated:
the browser is used to create or refresh a session, and HTTP requests reuse the resulting cookies.

Important clarification discovered later: this repository does contain the profile component names.
Its `docs/03-SDUI-API.md` and `docs/23-READ-DISCOVERY.md` list:

```text
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
com.linkedin.sdui.requests.profile.fetchProfileDiscoveryDrawer
com.linkedin.sdui.requests.profile.profilePolicyNotice
```

It also lists `voyagerIdentityDashProfiles` query-id variants as profile top-card reads.

What it does not provide is the complete PhantomBuster-style public-profile scraper contract: the
target-profile request body, the exact `vieweeProfileId`/`vanityName` combination, the React Flight
response decoder, and a field-by-field normalized output for experience, education, skills, and so on.
Its main scope is account-owner automation, profile edits, browserless reads, and endpoint/action
cataloging.

References:

- [Repository README](https://github.com/mguttmann/linkedin-internal-api)
- [SDUI API notes](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/03-SDUI-API.md)
- [Read discovery notes](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/23-READ-DISCOVERY.md)

### 3.2 `vicnaum/linkedin-toolkit`

This is useful for understanding the older/current normalized JSON style: `data`, `included[]`, URNs,
and profile parsing. It is especially useful for learning to resolve graph references safely rather
than treating `included[]` as one flat list. Its profile parser covers identity, about, location, and
experience concepts, but it is not a guaranteed contract for today's LinkedIn frontend.

### 3.3 `alabarga/linkedin-api`

This is a much simpler Python client and useful for seeing a minimal request flow. Its endpoints and
field assumptions are old (roughly the 2018-era API shape), so it is study material rather than a
current production route.

### 3.4 `joeyism/linkedin_scraper`

This is the Playwright/browser fallback. It can read rendered UI when an internal API is unavailable,
but it does not tell us which internal response supplied a field and is not the preferred production
transport for this challenge.

### 3.5 `marostr/linkedin-voyager_api`

This is primarily useful as a Ruby implementation reference. It does not solve the current profile
scraper by itself.

### 3.6 Additional references found during research

Additional current projects helped establish that LinkedIn's modern frontend is mixed and deployment
dependent:

- `devag7/linkedin-mcp` — current TypeScript section fan-out and profile tooling.
- `gabros20/linkedin-relay` — current GraphQL/relay observations and stale-route warnings.
- `yashiels/linkedin-cli` — operation/query catalog useful for comparison, but not a field contract.

The combined repository evidence does not provide one permanent, exhaustive profile schema. LinkedIn
changes route families, GraphQL query hashes, decorations, and SDUI component payloads.

## 4. LinkedIn backend concepts established before live probing

### 4.1 Session authentication

LinkedIn's private web APIs use the browser session, not a normal developer API key. Common values are:

- `li_at` — authenticated session cookie.
- `JSESSIONID` — session/CSRF-related cookie; the CSRF header commonly uses its `ajax:...` value
  without cookie quotes.
- `csrf-token` — request header derived from the session.
- Voyager requests commonly use `x-restli-protocol-version: 2.0.0` and a normalized-JSON Accept header.
- SDUI requests use additional page-bound headers generated at page load.

The exact header set is deployment and page-context dependent. Headers must be captured from the user's
own browser rather than invented.

### 4.2 Voyager and GraphQL

Older and still-active profile routes look like:

```text
GET /voyager/api/identity/dash/profiles
  ?q=memberIdentity
  &memberIdentity=<identifier>
  &decorationId=<projection>
```

Modern pages can also call:

```text
GET /voyager/api/graphql
  ?variables=(...)
  &queryId=voyagerIdentityDashProfiles.<deployment-hash>
```

The query name plus hash is a persisted-query identifier. The hash is not a person ID and can rotate
on LinkedIn deployments. The `memberIdentity` or `vieweeProfileId` value identifies the person.

### 4.3 Decorations

A decoration ID is a server-defined projection telling a Voyager endpoint which fields/edges to return.
It is not a universal schema and it is not the profile's identifier. Public references contain multiple
versions such as `FullProfile-76`, `FullProfileWithEntities-96`, `-101`, and `-109`; those versions
must not be assumed interchangeable or permanent.

### 4.4 Normalized JSON and URNs

Voyager normalized JSON behaves like a small graph database:

```json
{
  "data": {
    "*elements": ["urn:li:fsd_profile:TARGET"]
  },
  "included": [
    {
      "entityUrn": "urn:li:fsd_profile:TARGET",
      "$type": "...Profile",
      "*profilePositionGroups": "urn:li:collection:POSITIONS"
    },
    {
      "entityUrn": "urn:li:collection:POSITIONS",
      "*elements": ["urn:li:positionGroup:ONE"]
    }
  ]
}
```

The safe resolver is:

1. Index `included[]` by `entityUrn`.
2. Start from the target URN in `data["*elements"][0]`.
3. Follow references outward from that target.
4. Never collect all entities of a type globally, because `included[]` can contain supporting entities
   belonging to another profile.
5. Report an unresolved reference instead of inventing a value.

### 4.5 Lazy sections

The older model predicted separate profile component/card routes for experience, education, skills,
certifications, languages, honors, projects, and volunteering. That remains conceptually useful, but
the live test showed that the current viewed-profile page uses SDUI/RSC rather than a simple sequence of
`/voyager/api/` section endpoints.

## 5. Local workspace and files

The workspace is:

```text
/Users/main/profwork/tross_linkedin
```

Important files:

- [LINKEDIN_PROFILE_API_RESEARCH.md](LINKEDIN_PROFILE_API_RESEARCH.md) — long-form synthesis.
- [linkedin-backend-map.html](linkedin-backend-map.html) — interactive backend/field map.
- [docs/README.md](README.md) — research-note index and status.
- [docs/01-BACKEND-MODEL.md](01-BACKEND-MODEL.md) — Voyager/URN/backend model.
- [docs/02-REPOSITORY-AUDIT.md](02-REPOSITORY-AUDIT.md) — reference-repository audit.
- [docs/03-FIELD-EVIDENCE.md](03-FIELD-EVIDENCE.md) — challenge-field evidence/confidence.
- [docs/04-LOCAL-PROBE.md](04-LOCAL-PROBE.md) — original browser-first Voyager probe instructions.
- [docs/05-DECISIONS-AND-OPEN-QUESTIONS.md](05-DECISIONS-AND-OPEN-QUESTIONS.md) — decisions and gates.
- [docs/06-CORRECTIONS-AND-CONFIRMED-LIVE-FINDINGS.md](06-CORRECTIONS-AND-CONFIRMED-LIVE-FINDINGS.md)
  — corrections and current RSC findings.
- `browser-probe.js` — DevTools Snippet for safe, allowlisted Voyager discovery/replay.
- `probe.mjs` — disabled-by-default experimental Node transport.
- `analyze-capture.mjs` — offline capture analyzer.
- `src/coverage.mjs` — coverage reporting/resolution logic.
- `src/profile-url.mjs` — strict LinkedIn profile URL validation.
- `test/` — offline tests.
- `grbage/bnmc4331fne8fm9kp3n6mnwn0.js` — locally downloaded LinkedIn bundle containing the extension
  detection code.
- `captures/` — gitignored location intended for local captures/reports. No raw authenticated capture
  was committed.
- `.env` — local-only, mode `0600`, gitignored. Its contents were not read or printed.

`package.json` defines:

```text
npm test       -> node --test
npm run analyze
npm run probe
```

The offline test suite had 14 passing tests at the time of this handoff. The tests make no LinkedIn
network calls.

## 6. Original browser probe and why it failed

The first intended approach was deliberately conservative:

1. Install a DevTools Snippet without making a request.
2. Use Resource Timing to discover a profile request the current page had already made.
3. Review one allowlisted request.
4. Replay exactly one GET in the browser context.
5. Download the response deliberately and analyze it offline.

The snippet enforces same-origin and profile-URL checks, GET-only replay, no automatic fallback, no
automatic decoration/query-hash guessing, and a one-attempt latch. Its debug output is sanitized.

The first console discovery said:

```text
No core profile request found. Keep DevTools open, reload this profile, then run discover() again.
```

The page was being reloaded/unmounted while the snippet was installed, which made the Resource Timing
experiment unreliable. More importantly, the current LinkedIn page did not expose the target profile's
RSC calls as the old expected Voyager core request.

## 7. Chrome DevTools MCP connector

The user installed Google's `ChromeDevTools/chrome-devtools-mcp` and enabled auto-connect. This gave the
assistant read-only inspection/control of the existing Chrome profile, including:

- page listing and selection
- page reload/navigation
- page snapshots
- JavaScript evaluation
- Network request listing
- individual request/response inspection

The configured MCP command is currently equivalent to:

```text
npx -y chrome-devtools-mcp@latest \
  --auto-connect \
  --no-usage-statistics \
  --no-performance-crux \
  --blocked-url-pattern=chrome-extension://*/*
```

The connector was verified against the LinkedIn profile tab. The user should keep unrelated tabs closed
because a connected MCP server can inspect open browser pages in the selected Chrome profile.

## 8. The `chrome-extension://invalid/` confusion

### 8.1 What initially happened

The Network panel filled with thousands of entries like:

```text
GET chrome-extension://invalid/ [net::ERR_FAILED]
```

The first assumption was that one of the user's installed extensions was misbehaving. Chrome's
extensions page showed no installed extensions in the connected profile, so that assumption was
discarded.

### 8.2 Local bundle proof

The local file `grbage/bnmc4331fne8fm9kp3n6mnwn0.js` is approximately 2.67 MB. Around lines 9539–9552
it contains code equivalent to:

```js
for (const { id, file } of extensionList) {
  fetch(`chrome-extension://${id}/${file}`)
}
```

The same module contains `AbuseFeaturesCollectionCoordinator`, emits `AedEvent` with
`browserExtensionIds`, and performs a DOM scan for extension URLs as `SpectroscopyEvent`.

This is LinkedIn's own anti-abuse/extension-detection logic. When a probed extension does not exist,
Chrome masks the attempted extension ID and shows `chrome-extension://invalid/`. Disabling the user's
extensions is therefore not the fix.

### 8.3 Why output filtering was not enough

Filtering returned text can hide the invalid lines, but the MCP retains only a finite recent Network
history. The probes can evict genuine LinkedIn requests before the assistant reads them.

The documented MCP `--blocked-url-pattern` option was added and verified as a valid URLPattern. However,
the installed implementation still reports blocked attempts as failed Network events, so the pattern
does not guarantee a clean event buffer. It changes request delivery behavior, not necessarily whether
an attempted request appears in the DevTools history.

A page-level `fetch` hook was also tested. It was not reliable because LinkedIn's bundle/worker/frame
execution context is separate from the automation initialization context. This is why the current
capture procedure collects requests immediately after reload rather than relying on a long-lived clean
buffer.

## 9. Live Chrome findings

### 9.1 The first “profile GraphQL” request was for the viewer

After a reload, this request was visible:

```text
GET /voyager/api/graphql
  ?includeWebMetadata=true
  &variables=(memberIdentity:<ID>)
  &queryId=voyagerIdentityDashProfiles.<hash>
```

Its response contained only a profile entity URN and `versionTag`. Comparing its member identity with
`GET /voyager/api/me` proved that it was the logged-in viewer's initialization, not the viewed target
profile. The viewed profile's message link exposed a different target profile ID.

This corrected an important mistaken model: the first `voyagerIdentityDashProfiles` call was not a
complete target-profile response.

### 9.2 The target profile is current SDUI

An authenticated GET of the target profile URL returned approximately 920 KB of HTML containing the
target name and target profile ID. The rendered page contained the SDUI screen marker:

```text
data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"
```

The live DOM exposed semantic card IDs resembling:

```text
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>Topcard
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>About
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>Featured
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>Activity
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>ExperienceTopLevelSection
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>EducationTopLevelSection
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>CertificationTopLevel
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>Projects
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>VolunteerExperienceTopLevel
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID>SupportedLocales
```

These card identifiers are much better parsing anchors than LinkedIn's hashed CSS class names. Some
cards appear in the initial server-rendered document; other cards appear later in the live DOM.

### 9.3 The actual target-profile transport is RSC actions

An immediate reload-and-capture operation identified these requests:

```text
POST /flagship-web/rsc-action/actions/component
  ?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
  &sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
  &parentSpanId=<ephemeral>

POST /flagship-web/rsc-action/actions/component
  ?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
  &sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
  &parentSpanId=<ephemeral>
```

Other same-load SDUI requests included profile policy/discovery actions and unrelated system calls.
The profile component requests returned HTTP 200.

### 9.4 `profileCardsAboveActivity` request body

The body is JSON. The important fields observed were:

```json
{
  "clientArguments": {
    "payload": {
      "isSelfView": false,
      "vanityName": "<PROFILE_HANDLE>",
      "replaceableSectionArgs": {
        "vanityName": "<PROFILE_HANDLE>",
        "hideCardsForGoldenGate": false,
        "shouldSetupReplaceableComponent": true,
        "vieweeProfileId": "<TARGET_PROFILE_ID>",
        "isSelfView": false,
        "isSelfViewResolved": false
      },
      "profileComponentState": {
        "profileId": "<PROFILE_HANDLE>",
        "...": "many MemoryNamespace binding objects"
      }
    },
    "states": [],
    "requestMetadata": {
      "$type": "proto.sdui.common.RequestMetadata"
    },
    "screenId": "com.linkedin.sdui.flagshipnav.profile.Profile",
    "knownTemplateIds": []
  }
}
```

The full `profileComponentState` contains binding objects whose keys refer to page memory state. These
values are generated by the active page and should be captured rather than guessed.

### 9.5 `profileCardsActivity` request body

The activity request was smaller:

```json
{
  "clientArguments": {
    "payload": {
      "isSelfView": false,
      "vanityName": "<PROFILE_HANDLE>"
    },
    "states": [],
    "requestMetadata": {
      "$type": "proto.sdui.common.RequestMetadata"
    },
    "screenId": "com.linkedin.sdui.flagshipnav.home.Home",
    "knownTemplateIds": []
  }
}
```

The surprising `Home` screen ID is an observed fact; it should not be “cleaned up” in a replay without
testing, because LinkedIn may route activity through a shared home/feed component.

### 9.6 RSC response format

The requests used JSON input and returned an `application/octet-stream` response. The body was a
newline-delimited React Flight/RSC stream, not ordinary normalized profile JSON. Its beginning contained
records such as:

```text
1:I["<module-id>",[],"default"]
3:I["<module-id>",[],"TracedComponent"]
0:["$","div",null,{"data-sdui-component":"..." ...}]
```

The stream contains imported component references followed by serialized component trees. Within the
tree are semantic markers such as `data-sdui-component`, `componentKey`, and profile-card references.

The MCP inline response display truncated each response around 10,000 characters. Complete raw RSC
response files could not be saved because the connected MCP process had no negotiated filesystem root;
attempts to save both `/private/tmp/...` and workspace-relative paths were rejected. No raw response
was written to the repository.

## 10. What the current evidence means

The current viewed-profile flow is best represented as:

```text
profile URL + authenticated browser session
        |
        | initial server-rendered HTML/SDUI shell
        v
flagship-web/rsc-action component POSTs
        |
        | React Flight/octet-stream component trees
        v
semantic profile cards (Topcard, About, Experience, Education, ...)
        |
        v
our normalized scraper JSON
```

Voyager remains relevant for other reads and older/current top-card variants, but the first target
profile request observed in this session was not a complete Voyager graph. The target profile's visible
sections are delivered through the newer SDUI/RSC surface.

## 11. What is confirmed versus still unknown

Confirmed:

- LinkedIn uses both Voyager and SDUI/RSC backend families.
- `chrome-extension://invalid/` noise is caused by LinkedIn's own extension-probing bundle.
- The first observed `voyagerIdentityDashProfiles` call belonged to the logged-in viewer.
- The target profile page uses `data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"`.
- Target profile component POSTs use `/flagship-web/rsc-action/actions/component`.
- `profileCardsAboveActivity` and `profileCardsActivity` are real current component identifiers.
- The target request body includes `vanityName`, `isSelfView`, and (above activity) `vieweeProfileId`.
- RSC responses are streamed `application/octet-stream` React Flight/component trees.
- Stable-looking card IDs expose section names.

Still unknown:

- The complete RSC stream grammar needed for robust server-side decoding.
- Which RSC records contain each exact field and how optional/missing fields are represented.
- Whether skills and languages require additional component or detail requests.
- Whether one page load includes every section or only sections visible/eligible for that viewer.
- Which ephemeral SDUI headers are strictly required for a browserless replay.
- Whether the RSC payload can be replayed directly from a Cloudflare Worker, or whether a browser/CDP
  fallback is required.
- How LinkedIn behaves for restricted, logged-out, deleted, or rate-limited profiles.
- How stable card IDs remain across deployments and locales.

## 12. What should happen next

The next work should stay focused on one complete RSC response:

1. Keep the clean LinkedIn tab open and avoid unrelated pages.
2. Reload once and capture `profileCardsAboveActivity` and `profileCardsActivity` immediately.
3. Preserve the complete response outside the MCP inline truncation limit using an explicitly approved
   local capture mechanism; do not commit it.
4. Parse the React Flight records into an inspectable tree, initially preserving unknown records rather
   than dropping them.
5. Locate the card boundaries and map `Topcard`, `About`, `Experience`, `Education`, and
   `Certification` first.
6. Scroll or trigger detail surfaces only when needed to discover skills, languages, projects,
   volunteering, and other optional cards.
7. Compare at least three profile shapes: populated, sparse, and restricted/missing.
8. Record request headers by name and classify which are stable versus page-ephemeral; never put their
   secret values in documentation.
9. Decide whether the production architecture is browser-backed, browserless with replayed RSC, or a
   hybrid.
10. Only after the field/transport map is stable, design the normalized API response and hosted service.

## 13. Production architecture options (not yet chosen)

### Browser-backed

Use Playwright/Puppeteer/Chrome DevTools to load the profile, wait for SDUI cards, and extract the live
DOM or intercept RSC responses. This is closest to what LinkedIn executes, but it is heavier to host,
requires session persistence, and is not a natural Cloudflare Worker workload.

### Browserless RSC replay

Capture the exact SDUI request shape and required headers, then replay it with a normal HTTP client. This
is cheaper and potentially Worker-compatible, but page-bound headers, query/component deployments, and
React Flight decoding must be handled correctly.

### Hybrid

Use a browser only for session establishment, current page-bound metadata, and fallback sections; use
direct HTTP for stable reads. This is the direction suggested by the reference repo, but it cannot be
selected until the target-profile RSC response is decoded and tested.

## 14. Important mistakes to avoid repeating

- Do not assume `/voyager/api/identity/dash/profiles` or one GraphQL query is the complete current
  target-profile contract.
- Do not confuse the viewer's `memberIdentity` from `/voyager/api/me` with the viewed profile's ID.
- Do not treat `queryId` hashes as person identifiers.
- Do not treat decorations as universal schemas.
- Do not treat every `included[]` entity as belonging to the target profile.
- Do not blame `chrome-extension://invalid/` on the user's extensions without checking LinkedIn's bundle.
- Do not rely on output filtering to prevent a high-volume Network buffer from overflowing.
- Do not assume page-level JavaScript interception sees worker/frame requests.
- Do not publish raw cookies, CSRF headers, internal IDs, RSC captures, or personal profile data.
- Do not build the hosted API before the current transport and field coverage are evidenced.

## 15. Current one-paragraph status

The investigation has moved past “find a mysterious Voyager profile endpoint.” The current LinkedIn
profile page is a server-driven React/SDUI application. The reference repo already names the relevant
RSC components, and live Chrome capture confirmed their target-profile POST shape and streamed response
format. The remaining core task is decoding the complete RSC stream and mapping its semantic profile
cards into a stable scraper JSON schema. Everything before that is documented in this file and the
linked research notes.

