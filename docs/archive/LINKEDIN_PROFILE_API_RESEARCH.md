# LinkedIn Profile API — What the reference repositories are actually telling us

## The short answer

These repositories are not five competing libraries from which we should blindly choose one.
Together, they describe five different parts of the problem:

1. **Observe LinkedIn's web application** to learn which private requests it currently makes.
2. **Replay a read request** using a logged-in LinkedIn session.
3. **Resolve LinkedIn's normalized JSON graph** into ordinary profile objects.
4. **Use a browser only when a required section cannot be obtained reliably through a direct request.**
5. **Keep the public API schema independent of LinkedIn's internal response**, because LinkedIn can change its internals.

The best initial experiment is therefore not “build a scraper.” It is:

> Given one LinkedIn profile URL and fresh cookies from my own account, can a local JavaScript
> process call the current Voyager profile endpoint and obtain enough raw data to satisfy the challenge?

Only after answering that should we choose Cloudflare Workers, a normal Node host, or a hybrid.

---

## 1. The mental model: what happens when LinkedIn loads a profile

A logged-in browser already has a LinkedIn session. Two cookies are especially important:

- `li_at` is the login session token.
- `JSESSIONID` contains an `ajax:...` value used for CSRF protection.

The LinkedIn web page sends requests to private endpoints under `/voyager/api/...`. A backend
experiment can replay some read-only Voyager requests using the same cookies and headers. This is
not OAuth and not an official LinkedIn developer API.

A typical direct profile request currently looks like:

```text
GET https://www.linkedin.com/voyager/api/identity/dash/profiles
    ?q=memberIdentity
    &memberIdentity=<the slug after /in/>
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101
```

The important request data is approximately:

```text
Cookie: li_at=<session>; JSESSIONID="ajax:..."
csrf-token: ajax:...
x-restli-protocol-version: 2.0.0
Accept: application/vnd.linkedin.normalized+json+2.1
```

The `csrf-token` keeps the `ajax:` prefix but not the surrounding cookie quotes. A redirect to a
login page usually means that the session expired. A `403` can mean either a restricted profile or
an invalid session. A `429` means stop making requests and wait; repeatedly retrying is the wrong
response.

Sources: [mguttmann authentication notes](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/01-AUTH-AND-COOKIES.md), [vicnaum endpoint reference](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md).

---

## 2. Why LinkedIn's JSON needs a special parser

LinkedIn commonly returns “normalized JSON.” The main `data` object contains URN references, and
the actual objects live in one flat `included[]` array.

A simplified response looks like this:

```json
{
  "data": {
    "*elements": ["urn:li:fsd_profile:TARGET_ID"]
  },
  "included": [
    {
      "entityUrn": "urn:li:fsd_profile:TARGET_ID",
      "$type": "...Profile",
      "firstName": "Jane",
      "*profilePositionGroups": "urn:li:fsd_collectionResponse:POSITIONS"
    },
    {
      "entityUrn": "urn:li:fsd_collectionResponse:POSITIONS",
      "*elements": ["urn:li:fsd_positionGroup:GROUP_1"]
    }
  ]
}
```

The parser must first build an index:

```text
entityUrn -> included record
```

It then follows the URN references. It must not globally collect every object whose type is
`Position`, because `included[]` can also contain entities belonging to other people referenced in
the response.

For experience, the safe path is:

```text
target Profile
  -> *profilePositionGroups
  -> CollectionResponse.*elements
  -> PositionGroup.*profilePositionInPositionGroup
  -> CollectionResponse.*elements
  -> Position
```

The target profile itself should be resolved from `data["*elements"][0]`. Choosing the first
`Profile` object in `included[]` can silently return the wrong person.

Other parser details include:

- Some text is a string; some is an `AttributedText` object such as `{ text, attributes }`.
- Modern location data may require following `geoLocation.geoUrn` to a Geo record.
- Image URLs are assembled from a vector-image root URL and one or more image artifacts.
- Missing fields should become `null` or an empty array, not guessed values.
- Broken or unresolved URNs should be recorded as parsing warnings while developing.

Source: [vicnaum browser profile helper](https://github.com/vicnaum/linkedin-toolkit/blob/main/lnx/browser/fetch_profile.js).

---

## 3. What each repository contributes

### `mguttmann/linkedin-internal-api`

**Its job:** teach us how to reverse engineer the current LinkedIn web client.

Useful lessons:

- Cookie and CSRF authentication.
- The difference between classic Voyager REST.li requests and Voyager persisted GraphQL.
- How to record browser network traffic instead of guessing endpoints.
- How to distinguish expired-session redirects, forbidden responses, and rate limiting.
- GraphQL query IDs contain a stable-looking operation name plus a hash that can change after a
  LinkedIn deployment.

Most of its 130-endpoint inventory is irrelevant to this challenge. We do not need messaging,
posting, reactions, jobs, or profile-editing operations. Its SDUI research is also mostly irrelevant
because our challenge only reads profiles.

The most valuable architectural idea is to keep **capture tooling** separate from the production
reader. A developer uses a logged-in browser to discover or refresh requests; the hosted API uses a
small, read-only client.

Sources: [overview](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/00-OVERVIEW.md), [endpoint catalog](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/02-VOYAGER-API.md).

### `vicnaum/linkedin-toolkit`

**Its job:** teach us how to parse normalized Voyager responses correctly.

This is the clearest source for:

- resolving `data` and `included[]`;
- selecting the requested profile rather than another included profile;
- walking the position graph;
- unwrapping attributed text;
- resolving locations and company references;
- converting LinkedIn date ranges into a stable output.

Important limitation: its supplied profile normalizer is deliberately narrow. It emits the basic
profile plus experience. Although the raw graph can refer to education and other entities, the
library does not prove that every challenge section is always returned, nor does it parse all of
them. We still need to inspect our own captured responses for education, skills, certifications,
languages, images, and the other sections.

Sources: [profile client](https://github.com/vicnaum/linkedin-toolkit/blob/main/lnx/api/client.py), [endpoint and parsing notes](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md).

### `alabarga/linkedin-api`

**Its job:** show the older, minimal Python version of the direct-client idea.

It is useful for understanding the overall flow—authenticate, send Voyager requests, normalize
results—but its profile endpoints and login behavior are old enough that they should not be copied
into the challenge project. Even its package metadata identifies it as an early learning project.

Use it as historical background, not as a source of current endpoint truth.

Sources: [repository](https://github.com/alabarga/linkedin-api), [package metadata](https://github.com/alabarga/linkedin-api/blob/master/setup.py).

### `joeyism/linkedin_scraper`

**Its job:** show the browser-automation alternative and a useful profile output model.

The current version uses Playwright, Chromium, and a persisted authenticated browser session. This
can help when a visible profile section is not available from the direct Voyager response. It also
shows how profile, company, job, and post data can be represented as structured models.

Its costs are significant:

- Chromium must run somewhere.
- Browser sessions and storage state must be persisted and refreshed.
- UI selectors and page behavior can change.
- It is slower and more resource intensive than one or several direct JSON requests.

Therefore it should be a fallback, not the first implementation.

Source: [joeyism/linkedin_scraper](https://github.com/joeyism/linkedin_scraper).

### `marostr/linkedin-voyager_api`

**Its job:** provide a recent Ruby example of a cookie-supplied Voyager client.

It reinforces the idea that login/session acquisition and direct API reading should be separate.
The caller supplies `li_at` and `JSESSIONID`; the client derives the headers and makes HTTP
requests. Its design notes also identify bugs inherited from older clients, which is a useful warning
against copying stale implementations.

It is relevant conceptually, but not as our implementation base because the project is JavaScript
and the Ruby library is small and not extensively proven in production.

Source: [Ruby gem design](https://github.com/marostr/linkedin-voyager_api/blob/main/docs/superpowers/specs/2026-03-25-linkedin-voyager-api-gem-design.md).

---

## 4. Does one Voyager request return the entire profile?

We should not assume that it does.

The `FullProfileWithEntities` REST request is the right first probe because it avoids a rotating
GraphQL query hash and is known to return basic identity, location, summary, experience, and at least
some linked profile entities.

However, the current profile page can also make calls in families such as:

```text
voyagerIdentityDashProfiles
voyagerIdentityDashProfileCards
voyagerIdentityDashProfileComponents
```

Those are persisted GraphQL operations. Their hashes can rotate when LinkedIn deploys a new web
client. A field visible on the page may therefore be:

1. present in the first REST response;
2. present in the graph but not yet parsed;
3. loaded by a second Voyager request when its profile card becomes visible; or
4. unavailable to the logged-in account because of privacy or relationship rules.

This is why we need a real local capture before designing the final scraper.

---

## 5. The local investigation, before building an API

### Experiment A — validate the session

Use fresh `li_at` and `JSESSIONID` values from our own logged-in browser. Make a harmless read such
as `/voyager/api/me`. Record only the status and response shape; never print the cookies.

Success means direct HTTP is at least possible from the local machine. A login redirect means the
cookies are expired or malformed.

### Experiment B — call the REST profile endpoint

Extract the identifier from this URL:

```text
https://www.linkedin.com/in/some-person-123/
                            ^^^^^^^^^^^^^^^
```

Call `identity/dash/profiles` using that identifier and save the raw JSON in a gitignored local
capture directory. Test with:

- our own profile;
- one ordinary visible profile;
- one profile with many sections;
- one restricted or nonexistent profile.

### Experiment C — make a coverage table

For each challenge field, mark where it is found:

| Challenge field | REST response | Extra page request | Not visible |
|---|---:|---:|---:|
| Name/headline/location/about | ? | ? | ? |
| Experience | ? | ? | ? |
| Education | ? | ? | ? |
| Skills | ? | ? | ? |
| Certifications | ? | ? | ? |
| Languages | ? | ? | ? |
| Profile/background images | ? | ? | ? |

This evidence tells us the number of upstream calls actually needed.

### Experiment D — capture the missing requests

Open Chrome DevTools on the same profile page, select the Network panel, filter for
`/voyager/api/`, reload the page, and open any relevant profile sections. For each relevant request,
capture:

- method and full path;
- query parameters, especially `queryId`, `variables`, and `decorationId`;
- required headers;
- response shape;
- which challenge fields it supplies.

Save sanitized JSON fixtures, not cookies or complete request headers. The parser can then be tested
without repeatedly calling LinkedIn.

### Experiment E — decide if a browser fallback is necessary

Only introduce Playwright if one or more required visible sections cannot be obtained by replaying
the captured read requests. Browser automation is a contingency, not the starting point.

---

## 6. Should the hosted API use Cloudflare Workers?

### When Workers is a good fit

A Worker is attractive if the proven solution is:

- accept a URL;
- make a small number of direct `fetch()` calls;
- resolve and normalize JSON;
- return JSON;
- store `li_at`, `JSESSIONID`, and the public API key as Worker secrets.

Workers support outbound `fetch`, secrets, and enough subrequests for this design. The network wait
does not count as CPU time, although parsing a very large response does. Cloudflare recommends
keeping credentials in secrets rather than configuration or source control.

Sources: [Cloudflare environment variables and secrets](https://developers.cloudflare.com/workers/configuration/environment-variables/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### What must be tested before choosing Workers

LinkedIn may treat a request from Cloudflare's network differently from the same request on a local
machine. We must deploy one private probe and test:

- whether LinkedIn accepts the outgoing request and headers;
- whether the session survives the network change;
- whether response status and fields match the local call;
- how the Worker reports redirect, `403`, and `429` cases;
- whether response parsing stays comfortably inside the free-plan CPU budget.

The fact that browserless requests work from one maintainer's machine does not prove they work from
every cloud network.

### When a normal Node host is better

Use a normal Node host if we need:

- Playwright or Chromium as a fallback;
- a persistent browser profile;
- manual login or checkpoint recovery;
- more control over region, IP behavior, and long-running browser state.

Cloudflare has Browser Rendering/Playwright support, but Cloudflare documents that Browser Rendering
traffic is identified as bot traffic. That makes it a poor “stealth fallback” for LinkedIn.

Source: [Cloudflare Playwright documentation](https://developers.cloudflare.com/browser-run/playwright/).

### Practical decision rule

```text
Local direct Voyager works
  |
  +-- All required fields available through direct requests
  |     -> test the same requests from a private Cloudflare Worker
  |          +-- works reliably -> use Workers
  |          +-- blocked/unstable -> use a small normal Node service
  |
  +-- Required sections need browser interaction
        -> use a normal Node host with Playwright
           (optionally put a Worker in front as an API gateway/cache)
```

---

## 7. What the eventual public API should hide

The submitted API should accept only a LinkedIn profile URL. It should never accept or return
LinkedIn cookies. Its public response should be our schema, for example:

```text
profile
  identity
  location
  about
  images
  experience[]
  education[]
  skills[]
  certifications[]
  languages[]
metadata
  fetchedAt
  source
  partial
  warnings[]
```

That stable schema protects the API consumer from LinkedIn's URNs, type names, decoration versions,
and GraphQL hashes. If one section cannot be read, a partial response plus a warning is more honest
than returning invented or misattributed data.

The public API also needs its own bearer key or equivalent protection. Otherwise anyone who finds
the endpoint can consume the LinkedIn account's rate limit and trigger account restrictions.

---

## 8. Main risks and known limitations

- These are unofficial, undocumented endpoints and may change without notice.
- A LinkedIn account or session may be challenged, restricted, or logged out.
- Profile visibility depends on the authenticated account and its relationship to the target.
- Query hashes and decoration IDs are web-client implementation details, not contracts.
- Rate limits are not publicly specified; repository pacing numbers are observations, not guarantees.
- Browser fallback improves coverage but adds cost and another source of breakage.
- Scraping or replaying private endpoints may conflict with LinkedIn's terms. The submission README
  should state this plainly and describe the project as an educational reverse-engineering exercise.
- Cookies are equivalent to an authenticated session and must never be committed, logged, returned,
  or included in captured fixtures.

---

## 9. Recommended next move

Do not build the hosted API yet.

First, write one very small local JavaScript probe that performs Experiments A and B and saves one
raw response privately. Then inspect that response together and fill in the coverage table. That
single result will tell us whether the challenge is mainly a JSON-normalization task or whether it
also needs profile-card request capture and possibly Playwright.

That is the point at which implementation should begin.
