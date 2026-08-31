# 09 — Strategy: shipping the hosted LinkedIn Profile API

> **Status (updated 2026-08-31).** Build plan largely executed. Two corrections: the Cloudflare-hosting assumption was wrong (a datacenter IP invalidates a browser-minted session — the API runs on a laptop), and the outbound limiter must be a Durable Object, not KV, because KV's eventual consistency lets concurrent requests fire at once.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


The build plan, grounded in `08-SYNTHESIS.md`. Where a claim is not yet evidenced it is marked,
because the reference repos' single best habit is refusing to state more than they proved.

## 0. What the challenge actually requires

A hosted HTTPS endpoint: `profile URL in → normalised JSON out`, covering name, public
identifier, headline, location, about, experience, education, skills, certifications, languages,
profile image, cover image.

**All of that is now reachable in one upstream request.** The work left is not discovery — it is
the service around it: reliability, honesty about failure, and not getting the account killed.

## 1. The decision that shapes everything: one call, not thirteen

```
GET /voyager/api/identity/dash/profiles
    ?q=memberIdentity&memberIdentity=<slug>
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101
```

Verified: 92 KB, 104 records, every target field, counts identical to the 12-call fan-out.

Why this is strategic rather than a micro-optimisation:

- **Rate-limit budget is the scarce resource.** The measured envelope
  (`linkedin-toolkit` §13) is ~1 profile/sec sustained. At 13 calls/profile that is one profile
  per 13 s; at 1 call it is 13× the throughput for the same risk.
- **Fewer moving parts rot slower.** The fan-out depended on a `sectionType` enum that appears in
  *no* reference repo and cannot be validated by probing (an unknown name and an empty section are
  byte-identical). The decoration returns typed references instead — no guessed strings.
- **It deletes the React Flight decoder from the hot path**, and with it the top-card heuristics
  that twice picked the wrong string as the headline.

Keep `src/flight.mjs` and `src/sections.mjs` in the repo as the documented fallback, not the
default. If the decoration rotates, `ProfileComponents` still works.

## 2. Architecture

```
Cloudflare Worker
  auth      li_at + JSESSIONID from Worker secrets; csrf derived, never stored separately
  classify  status + content-type + body  ──►  outcome        (BEFORE any parsing)
  fetch     1 × dash/profiles                                  (+ fallback path only on drift)
  parse     index included[] by entityUrn ──► walk from data.*elements[0]
  respond   { ok, profile, meta }
```

**Classify before parse** is the load-bearing rule. A 410, a 999 or a login redirect handed to a
parser yields a *plausible empty profile* — the worst possible output, because it is
indistinguishable from a real member with an empty profile.

**Never return an empty success.** A genuine empty is `ok:true, state:'complete'`. Auth failure,
throttling, drift, or `referenced > 0 && resolved === 0` is `ok:false`.

## 3. Error taxonomy — one rule above all

From `SESSION-AND-ERRORS-DESIGN.md` §2, now implemented in `classify()`:

> **Exactly one signal proves the session is dead: a 3xx whose `Location` is the login wall.**

Everything else must leave `sessionDead=false`. This is not pedantry — the reference repo
documents a real incident where a 302 loop was chased as TLS fingerprinting and stealth-browser
work for days, when the cookies had simply expired. And its inverse: treating every 403 as session
death triggers needless re-logins when the actual cause is a malformed csrf header.

| signal | meaning | session dead? |
|---|---|---|
| 3xx → `/uas/login` | cookies stale | **yes** — the only case |
| 403 | csrf header malformed **or** that one profile is restricted | no — probe `/me` to tell which |
| 401 | not established by any reference | no — declare unknown |
| 400 | decoration rotated, or a full `urn:` passed to `memberIdentity` | no |
| 410 | endpoint retired (this is what killed `profileView`) | no |
| 429 | throttled — **stop, never retry** | no |
| 999 | network-layer bot block | no |
| 200 + `data.errors` | **false success — the status code lies** | no |
| 200 + null section, no error | silent throttling, shape-identical to a bad enum | no |

The last two are why status codes alone are not a classification.

## 4. Rate limiting and account safety

**The account is the irreplaceable asset.** Not the code, not the deploy — a LinkedIn identity
cannot be re-registered.

- **Zero automatic retry on 429.** `linkedin-relay` breaks with its own siblings here and is
  right: on LinkedIn a 429 is the warning shot on a ladder (warning → 1–3 week restriction →
  permanent ban), so retrying is the mechanism that converts a warning into a restriction.
- **Cooldowns live in durable storage** (KV/D1), not process memory — a Worker is a swarm of
  short-lived isolates, and an in-memory breaker protects nothing. `429` → 1 h, `999` → 6 h,
  challenge → indefinite until a human logs in.
- **Pace reads as hard as writes.** Multiple documented restrictions involved zero automation and
  zero writes — fast manual browsing alone. Pacing only writes aims at the wrong threat.
- **Budget:** start at 1 req/s with 0–1.5 s jitter and a daily cap, from the one *measured* table
  (`linkedin-toolkit` §13: 1700+ profile fetches sustained at that rate). Ignore the widely-quoted
  "~50 profiles/day" — it is SEO-blog lore with no methodology. Every cap ships with its
  provenance (`measured` | `vendor-lore` | `guessed`) so nobody later mistakes a guess for a
  measurement.
- **Cache aggressively.** The cheapest request is the one not sent; it is also the safest.

## 5. Surviving rot — the two things guaranteed to break

**queryId hashes and decoration ids are pinned to LinkedIn's deployed web build.** The client
mints them at runtime via `getGraphQLQueryId()` against its webpack bundle; the `-101` suffix
versions the same way. Cadence unknown.

Therefore: **hashes are configuration with provenance, never literals in request logic.**

```ts
type Contract = { path, decorationId?, queryId?, provenance: 'verified'|'discovered'|'inferred', capturedAt }
```

Only `verified` contracts serve traffic. A 400 naming an unknown decoration is a *drift signal*,
not a bug — it should page, not silently degrade. `profileView`'s 410 is the cautionary tale: it
silently invalidated the most-starred client in the ecosystem, and four of the eight repos here
still depend on it.

**Detect drift actively:** `meta.unknownTypes` counts every `$type` the parser did not recognise.
Unknown types pass through as data and are *reported*; they are never dropped. An accept-list is
what makes losses invisible — it cost a sibling project every reply in every thread and 34 of 77
posts per page, all behind `ok:true`.

## 6. Correctness traps already handled

- **`Q-POSITION-GRAPH-WALK`** — a response may carry `Position` records belonging to *other*
  people cited in it. Filtering `included[]` by `$type` silently attributes strangers' jobs to the
  subject. We walk `Profile → PositionGroups → elements → Position`.
- **`Q-MULTIPLE-PROFILES`** — subject is always `data.*elements[0]`, never `included.find(Profile)`.
- **`Q-ATTRIBUTED-TEXT`** — unwrap `{text, attributes}`; skip `multiLocale*` or every field dupes.
- **`fs_` / `fsd_` drift** — one `canonicalUrn()`; read as `dash ?? legacy`.
- **Three-state resolution** — referenced-and-missing is a *failed decoration*, not "no data".

## 7. Build order

| # | Step | Gate |
|---|---|---|
| 1 | ✅ browserless transport + graph parser + classify | done; validated on 2 profiles |
| 2 | Cookie bootstrap: CDP mint → Worker secrets, documented refresh | `li_at` weeks–months, `JSESSIONID` ~30 d |
| 3 | Worker: KV cooldown + budget ledger + cache, `/profile?url=` | never exceeds budget under load |
| 4 | Fixture tests from saved `raw.json` — parser is offline-testable | zero network in CI |
| 5 | Populated long tail: one member with languages/courses/orgs | closes §8 |
| 6 | Restricted + deleted profile behaviour | 403/404 distinguishable from empty |

Steps 4–6 need **no** new discovery. Step 5 is the only one needing a live request, and it needs
exactly one profile.

## 8. Open, and honestly so

- Long-tail collections (`languages`, `courses`, `projects`, `honors`, `publications`, `patents`,
  `organizations`, `volunteering`, `testScores`) are **proven to resolve, not proven to populate** —
  both test profiles genuinely have none.
- `about`/`summary` likewise. `21-PROFILE-ABOUT.md` confirms it is served by this exact decoration,
  and warns the Voyager read **collapses `\n\n` paragraph breaks** while the SDUI form state
  preserves them. So our About will be *complete but unparagraphed* — acceptable, and it must be
  documented rather than discovered by a user.
- **Contact info has no working browserless GET.** `profileContactInfo` is 410 and the dash
  variants return 400/500. Out of scope for the challenge; do not promise it.
- Restricted/deleted profiles untested.
- `li_at` lifetime and the minimal cookie set: every source guesses, none isolates it. Do not
  compute an expiry from `li_at` — it is opaque, not a JWT, and any number derived from it is
  fabricated.

## 9. Scope discipline

The reference repos map ~130 endpoints and a large write surface. **None of it is in scope.** This
is a read-only profile API: no posting, no messaging, no connecting, no endorsing. Read-only is
both the product and the safety posture — the write surface is where account-ending actions live,
and the challenge does not ask for it.

Legal posture (`08-SYNTHESIS.md` §9): with an account in the loop, `hiQ` makes the CFAA question
moot and the **User Agreement is the entire exposure surface**, regardless of scale. Keep the
existing constraints in force — owner's account only, secrets never in chat or git, `captures/`
gitignored, no fan-out probing, no automatic retry. And keep the Proxycurl founder's conclusion
where the next person will read it: **"Legal does not mean safe."**
