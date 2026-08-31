# START HERE

> **Superseded 2026-08-31.** Its job was absorbed by
> [`../../ai_context_mini.md`](../../ai_context_mini.md) (agent orientation) and
> [`../../README.md`](../../README.md) (human entry point). Two entry points telling you to
> "start at one or the other" was the confusion this removes. Kept for provenance.


Reverse-engineered LinkedIn profile API → hosted HTTPS service.
**50 of PhantomBuster's 51 fields**, core profile in **one upstream request**, 28 offline tests.

---

## Read in this order

| # | file | why |
|---|---|---|
| 1 | **[README.md](README.md)** | what it is, how to run it, coverage, architecture |
| [docs/API.md](../API.md) | the API: auth, the one call, parsing traps, pagination, hash rotation, repo provenance |
| [docs/OPERATIONS.md](../OPERATIONS.md) | what it costs + the maintenance runbook: failure signals, throttling, incidents, rotating hashes |
| [docs/BUILD.md](../BUILD.md) | architecture, coverage, bugs and what caught them, and the full API contract |
| [docs/FIELDS.md](../FIELDS.md) | the 51 columns, how each is filled, source path in the payload |
| [docs/TESTING.md](../TESTING.md) | the five fixtures and how to verify them in a browser |
| [docs/archive/](./) | superseded notes — **contains disproved conclusions** |

Those four are the whole story. Everything below is reference.

---

## Run it

```bash
npm install --prefix api
cd api && npx wrangler dev --port 8810
node --test tests/     # 28 tests offline; 21 need local captures, 7 run on a fresh clone
```

```bash
curl 'http://127.0.0.1:8810/profile?url=https://www.linkedin.com/in/<slug>/' \
  -H "x-li-at: $LI_AT" -H "x-li-jsessionid: $JSESSION"
```

Add `&format=flat` for the PhantomBuster-shaped output, or
`&enrich=social,counts,company` for the +1-request fields.

---

## The five things worth knowing

1. **One call gets the profile.** `identity/dash/profiles` + `FullProfileWithEntities-101`.
   The legacy `profileView` is **HTTP 410** — it kills the profile path of the most-starred
   OSS client, and four of the eight repos we read inherit it.
2. **Throttling is silent** — HTTP 200, null section, no error. Byte-identical to an unknown
   section name *and* to a genuinely empty one. A null proves nothing.
3. **A datacenter origin breaks a browser-minted session.** Not a network block: unauthenticated calls
   from Cloudflare are served fine. Authenticated reads need residential egress.
4. **Repos disagree because each is a snapshot of a different client** (web / Android /
   legacy) at a different date — see `API.md` §10. queryId hashes rotate, and the web
   bundle is the catalogue: `static.licdn.com` registers
   all 933 queries as `{id, name}` — readable with **no cookies, no API calls**.
5. **Never an empty success.** Failures are `ok:false` with a named cause; an empty section is
   `[]` with `state: "complete"`. Almost every bug we hit was an empty value read as proof of
   absence.

---

## Reference

| file | contents |
|---|---|
| [ai_context_mini.md](../../ai_context_mini.md) | dense API reference, for feeding to an agent |

## Code

| path | what |
|---|---|
| `api/src/index.js` | Hono routes, enrichment orchestration |
| `api/src/upstream-do.js` | Durable Object limiter — serialises + paces every upstream call |
| `api/src/classify.js` | status → outcome, **before** parsing |
| `src/profile-graph.mjs` | the parser: URN graph, truncation detection, drift telemetry |
| `src/flatten.js` | PhantomBuster-compatible shape + `UNAVAILABLE` with reasons |
| `src/normalized.js` · `src/company.js` · `src/enrich.js` · `src/topcard.js` | enrichment parsers |
| `relay/server.mjs` | optional residential-egress relay |
| `profile.mjs` | CLI |
| `tools/queryids.mjs` | extract the queryId catalogue from a JS bundle (no cookies) |

## Ground rules

- **Read-only.** No writes, ever.
- **Credentials per request**; bound secrets need `ALLOW_BOUND_CREDENTIALS=true`.
- **No retries.** 429 → 1 h cooldown, 999 → 6 h.
- **Never `redirect: 'follow'`** against Voyager — a self-redirect loops ~20× in seconds.
- **Use an account you are prepared to lose.** The account is the irreplaceable asset;
  `OPERATIONS.md` §3 documents five incidents that prove it.
