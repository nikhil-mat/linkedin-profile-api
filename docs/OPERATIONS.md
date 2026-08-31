# Operations — what it costs, and keeping it working

Everything here was learned by doing it wrong at least once. The account is the irreplaceable
asset — not the code, not the deploy. A LinkedIn identity cannot be re-registered.

---

## 0. What is ours vs what is in refs/

Almost everything in this file is **ours** — the reference repos document endpoints, not
operating consequences. The one borrowed piece is the rate table in §2, which comes from
`refs/linkedin-toolkit/references/endpoints.md` §13, the only measured numbers in any repo.

`refs/linkedin-relay/docs/research/R3-linkedin-surface.md` §5 is the best existing write-up of
LinkedIn's defences (999, challenges, the escalation ladder, the legal position) and reaches the
same zero-retry / cooldown-as-a-file design independently — worth reading alongside §4 here.

---

## 1. Failure signals, and the one that actually means "session dead"

> **Exactly one signal proves the session is dead: a 3xx whose `Location` is the login wall.**
> Everything else must leave `sessionDead = false`.

| signal | meaning | session dead? |
|---|---|---|
| `3xx` → `/uas/login`, `/checkpoint` | cookies stale | **YES — the only case** |
| `3xx` → **the same URL** (self-redirect) | session/CSRF no longer accepted → re-extract | no |
| `403` `"CSRF check failed."` | csrf malformed, **or** that one profile is restricted | no |
| `401` | undocumented in any repo — declare unknown | no |
| `400` | decoration rotated, or a full `urn:` passed to `memberIdentity` | no |
| `404` | no such profile, or rotated hash | no |
| `410` | endpoint retired | no |
| `429` | throttled → **stop**, cooldown | no |
| `999` | network-layer bot block (pre-auth) | no |
| `200` + `errors` in body | **false success — the status code lies** | no |
| `200` + null section + no error | **silent throttling** | no |

**Classify before parsing.** A 302/410/999 handed to a parser produces a *plausible empty
profile*, indistinguishable from a real one. That is the worst possible output.

**Content-type gotcha:** Voyager answers `application/vnd.linkedin.normalized+json+2.1`. A naive
`ctype.includes('application/json')` check rejects **every successful response**. Match `+json`.

### The 302 self-redirect, in detail

We misdiagnosed this twice. A `302` whose `Location` is the identical URL is **not** a datacenter
block and **not** an account restriction — it means the session/CSRF is no longer accepted.
Refreshing `JSESSIONID` fixed it and the same request then returned 200.

⚠️ **Never `redirect: 'follow'` against Voyager.** Following a self-redirect loops ~20 times
before the runtime aborts — a burst of authenticated hits far more dangerous than the original
request. We did this twice and generated ~40 hops in seconds.

---

## 2. Throttling is silent

Not a 429. **HTTP 200, section `null`, no GraphQL error.**

✅ Control test — three causes, one identical response:
```
sectionType:experience             → 200, populated, 73,314 B
sectionType:volunteer_experience   → 200, null,        547 B, no error
sectionType:totally_bogus_section  → 200, null,        548 B, no error
```
⇒ An unknown section name is **byte-identical** to an empty section and to throttling. A null
proves nothing. The only reliable discriminator is a section *known* to be populated for that
member returning null.

✅ Direct evidence: an identical 12-section sweep succeeded at 19:26–19:27 and returned nothing
at 19:29. Same code, same names, two minutes apart.

**A client must treat `200 + null + no error` as *retry later*, never as *empty section* — and
must not re-probe to find out which.**

### Rates

The only *measured* numbers (📖 `linkedin-toolkit` §13):

| operation | delay | sustained |
|---|---|---|
| paginated GETs | 0.4–0.5 s | 1500+ |
| profile fetch, batch | 0.6 s | 50 |
| profile fetch, long batch | 1.0 s + 0–1.5 s jitter | 1700+ |

Ignore "~50 profiles/day" / "~900 req/hr" — SEO-blog lore with no methodology.

⚠️ **That table measured steady paginated reads on one account.** It is *not* authorisation for
bursty fan-out across many distinct third-party profiles, which is a different traffic signature.
We treated it as if it were.

**Never retry a 429.** Escalation is warning → 1–3 week restriction → permanent ban; retrying is
the mechanism that converts a warning into a restriction. `429` → 1 h cooldown, `999` → 6 h,
challenge → indefinite. **Cooldowns belong in durable storage**, not process memory.

**Pace reads as hard as writes.** Documented restrictions have followed fast *manual browsing*
alone. A design that paces only writes aims at the wrong threat.

---

## 3. Where sessions and accounts actually die

### 3.1 Datacenter egress breaks a session — mechanism UNPROVEN

Observed 2026-08-30/31: a session worked locally (200), was used once from Cloudflare edge
egress (302 self-redirect), then failed **locally** too (302), and worked again (200) only after
re-extracting `JSESSIONID`.

Two hypotheses fit, and both are "the datacenter origin is the problem":

1. **Presenting the session from a datacenter IP invalidated it.**
2. **LinkedIn refuses authenticated traffic from datacenter IPs**, and the local failure had a
   separate cause.

The evidence favours (1): under (2) the *local* request afterwards should still have worked, and
it did not. Natural cookie rotation is ruled out — `JSESSIONID` is set at login and no logout
occurred between the working and failing calls.

**Not proven either way.** We never retested from the edge with fresh credentials, so this is
n=1. What IS measured: *unauthenticated* calls from Cloudflare are served normally
(`403 CSRF check failed.`, never `999`), while the rendered profile **document** is `999`-blocked
from datacenter IPs. Running the API on residential egress sidesteps the question rather than
answering it — and that is the honest reason it does.

### 3.2 Fabricated profile data triggers identity verification

Filling a throwaway account with fake employment to build a test fixture produced
`checkpoint/lg/login-restricted` demanding **government ID**. That is the *authenticity*
checkpoint — a different system from rate limiting. It fired on **profile content**, not read
volume.

The advice that caused it was mine and it was wrong: I suggested "obviously fake" company names
to avoid misrepresenting real employers. Obviously-fake employers are exactly what the
fake-account classifier scores on. Both options are bad:

- fake jobs at a **real** company → misrepresentation
- fake jobs at a **fake** company → authenticity signal

**Never fabricate employment.** If a richer fixture is genuinely needed, add only *non-assertive*
sections — skills, languages, courses, projects, test scores. They claim nothing about an
employer and were the higher-value ones anyway.

Once flagged, the device/IP is associated: new signups from the same context are blocked too.
**Do not create accounts to route around it** — accounts created during a restriction get
flagged as well. Wait, or appeal. Do not spend a government ID on a throwaway.

### 3.3 The incidents, honestly

| # | what | cause |
|---|---|---|
| 1 | ~30 section reads → silent throttling | fan-out probing for facts the reference repos already documented |
| 2 | account restricted, gov-ID checkpoint | fabricated employment on a throwaway |
| 3 | session invalidated | one authenticated call from Cloudflare egress |
| 4 | ~40 rapid hops on `/me` | `redirect: 'follow'` against a self-redirecting endpoint |
| 5 | **36 unintended authenticated requests** | a "no credentials → no traffic" test that silently fell back to **bound** credentials, in a fixed 36-iteration loop whose first response already said `CSRF_REJECTED` |

Incident 5 is the important one for design, not just conduct:

- **A credential fallback is a footgun.** `credsFrom()` fell back to bound secrets when headers
  were absent, so a request that looked credential-less carried a real session. Per-request
  credentials must be the *only* path, or the fallback must require an explicit opt-in flag.
- **Never loop.** Check the first response before sending a second.
- **The inbound rate limiter did not fire** — `wrangler dev` does not simulate the native
  rate-limit binding locally, so nothing stood between the loop and the account.

---

## 4. Rules that came out of this

1. **Read the docs before spending a request.** Most things we probed for were already written
   down in `refs/`. The pagination URN shape was sitting in our own saved captures.
2. **One request at a time.** No loops, no batches. Inspect the response before the next call.
3. **Authenticated calls never leave a flagged machine or a datacenter.** Residential egress,
   and check where a command egresses *before* running it.
4. **No writes. Ever.** Read-only is both the product and the safety posture.
5. **Cache aggressively.** The cheapest request is the one not sent; it is also the safest.
6. **Every cap carries its provenance** (`measured` / `vendor-lore` / `guessed`) so nobody later
   mistakes a guess for a measurement.
7. **Use an account you are prepared to lose.** Never a primary one.

---

## 5. Legal posture

Operating through an authenticated session makes the **User Agreement**, not the CFAA, the
exposure surface. *hiQ v. LinkedIn* held that scraping public logged-out data is not a CFAA
violation, but explicitly does **not** immunise breach-of-contract once an account is in play —
the theory that worked in *LinkedIn v. Proxycurl* (N.D. Cal. 3:25-cv-00828, filed 2025-01-24,
settled; Proxycurl shut down). Scale is not the trigger: any account-holding relationship creates
contract exposure.

The Proxycurl founder's own conclusion, worth keeping where the next person will read it:
**"Legal does not mean safe."**

Practical constraints in force here: owner's account only, credentials never in chat or git,
`captures/` and `.env` gitignored (`.env` at 0600), no fan-out probing, no automatic retry.

---

## M1. What rotates, and what does not

| thing | rotates? | where it lives |
|---|---|---|
| `queryId` — `<resource>.<32-hex>` | **yes**, with LinkedIn's web deploys | `api/src/transport.js` |
| `decorationId` — `…FullProfileWithEntities-101` | **yes**, via the `-<n>` suffix | `api/src/transport.js`, `.env` |
| User-Agent major version | should track real Chrome | `src/li-http.mjs` `UA_PRESETS` |
| Field names (`positionHeld`, `websiteUrl`) | rarely, but shapes do move | the parsers |
| **paged-list URNs** | **no** — constructed from the member id | `ai_context_mini.md` §6b |
| Auth model (two cookies + csrf) | stable across everything we read | `src/li-http.mjs` |

The constructible things never break. The pinned things always will.

---

## M2. How you find out it broke

| symptom | almost certainly |
|---|---|
| **400** naming an unknown variable/query | queryId or decoration rotated |
| **200** with a valid-looking but nearly-empty record | **wrong query, not a broken one** — e.g. a stub that returns `{guideFetcher, entityUrn}` |
| `meta.unknownTypes` grows | LinkedIn added a `$type` — data still passes through, but a mapping may be missing |
| a field silently turns `null` everywhere | field renamed, or it moved to a sibling record |
| `state: "partial"` appearing on profiles that used to be `complete` | a collection cap changed |
| **410** | the endpoint was retired — do not retry, re-plan |

The tests are the tripwire: `node --test tests/` runs offline against saved captures and fails
on a **new** unknown `$type`, a changed field, or a coverage regression.

> ⚠️ The nastiest failure is not an error. `148b1aeb…` returned **HTTP 200** with a
> well-formed Company record containing two fields. Nothing errored; the data was simply
> absent. Always check that a response contains what you asked for, not merely that it parsed.

---

## M3. Getting fresh hashes — three ways, ranked

### 3.1 The web bundle registry ← use this

LinkedIn's own JS registers every persisted query:

```js
{kind:"query", id:"voyagerOrganizationDashCompanies.3ffd8651…", name:"member-company-by-universal-name"}
```

So the bundle is a **self-documenting catalogue**: hash → what the query actually *is*. It comes
from `static.licdn.com`, a plain CDN — **no cookies, no authenticated call, no account risk.**

```bash
# 1. save any LinkedIn page (the app shell is enough), then find its bundles:
grep -oE 'https://static\.licdn\.com/[^"]+\.js' saved-page.html | sort -u

# 2. fetch the big one, then:
node tools/queryids.mjs bundle.js                 # everything, name + hash
node tools/queryids.mjs bundle.js company         # filter by name
node tools/queryids.mjs bundle.js --json > data/queryids.json
```

Last run: **933 queries** from one bundle.

**Why it beats the alternatives:** traffic capture needs a live session and gives one endpoint at
a time, and a correctly-captured request can still be *mislabelled* by whoever wrote it down —
`linkedin-mcp` recorded `148b1aeb…` accurately and called it "company" when it is
`guide-entry-points`. The registry carries LinkedIn's own name for it, so that mistake is
impossible.

### 3.2 DevTools capture — when you also need the variables

The registry gives the hash and the name, **not the variable shape**. When a query needs
arguments you cannot guess, watch the real client:

1. Open the relevant page → DevTools → **Network**, filter `voyager/api/graphql`
2. 🔍 search (regex on) for `voyagerOrganizationDash[A-Za-z]*\.[0-9a-f]{32}`
3. Copy the `queryId=` **and** `variables=(…)` — the variables are the half that breaks people

⚠️ **Never paste cookies.** A "Copy as cURL" contains a full working session. Strip it to the
two query params.

**LinkedIn's GraphQL errors name what they want** — read the body, do not guess:
```
Variable 'pagedListComponent' has coerced Null value for NonNull type 'String!'
Variable 'viewerPermissions' … Expected type 'Map' but was 'String'
```
Both of those were solved by reading the error rather than trying another hash.

### 3.3 Android APK — static, but different field selections

`linkedin-cli` shipped 481 hashes decompiled from the APK. Useful when you have no session at
all. Caveat: Android hashes select Android-shaped fields, so some need
`accept: application/json` instead of the web `normalized+json` — see `API.md` §8.

---

## M4. Updating a hash

1. Find the correct one (§3.1) — **match on the query's `name`**, not on hope.
2. Update the constant in `api/src/transport.js`; leave a comment recording what the previous
   one turned out to be, so nobody retries it.
3. `node --test tests/` — offline, catches shape regressions.
4. **One** live request against a profile with known ground truth (`docs/TESTING.md`).
5. Save the response into `captures/` and add an assertion pinning the real value.

Do not batch. Check each response before sending the next.

---

## M5. Refreshing the User-Agent

The UA must match the browser **and OS that minted the cookies** — it is a property of the
session, not a constant. Chrome freezes minor/build/patch to `0.0.0`, pins Windows to `NT 10.0`
and macOS to `10_15_7`, so those literals are correct rather than stale. Brave sends a **Chrome**
UA. Track the major version from `github.com/jnrbsn/user-agents`; update `UA_PRESETS` in
`src/li-http.mjs`.

---

## M6. Refreshing credentials

`JSESSIONID` is set at login and does not rotate on its own, but it does change on logout/login,
and a mismatched pair produces a **302 self-redirect** that looks nothing like an auth error.

1. Log into LinkedIn in a browser (loading `/feed/` is what sets `JSESSIONID`)
2. Copy `li_at` **and** `JSESSIONID` from the *same* session — a fresh one against an old
   `li_at` is the same mismatch
3. Update `.env`, then `grep -E '^LINKEDIN_(LI_AT|JSESSIONID)=' .env > api/.dev.vars`
4. Verify with **one** request

---

## M7. Routine health check

```bash
node --test tests/          # offline, no credentials, no network — run freely
```

Then, sparingly, one live request against a ground-truth fixture and compare to
`docs/TESTING.md`. Watch `meta.unknownTypes`, `meta.truncated` and `meta.state`: they
are the drift signals, and they are why unknown types pass through as data instead of being
dropped.

**Do not run a loop to "check for flakiness".** A 429 costs far more than the check is worth.
