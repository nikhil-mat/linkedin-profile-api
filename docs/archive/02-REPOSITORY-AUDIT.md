# Repository audit

> **Status (updated 2026-08-31).** Verdict still holds, and is now stronger: no reference repo has a current complete implementation. Four of the eight are built on `profileView`, which returns **HTTP 410**. None implements profile-collection pagination, none documents `sectionType`, and none reads the web bundle's own query registry.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


## Verdict

The reference projects give us most of the mechanics, but no single repository provides a complete,
current JavaScript implementation of:

```text
LinkedIn profile URL → every visible profile section → normalized hosted API response
```

They also do not collectively publish a current raw full-profile fixture and exhaustive field schema.

## Original five repositories

| Repository | What it gives us | Important gap |
|---|---|---|
| [`mguttmann/linkedin-internal-api`](https://github.com/mguttmann/linkedin-internal-api) | Cookie/session handling, direct Voyager requests, capture tools, current endpoint inventory, error patterns | Broad automation project; profile read returns raw data and does not combine/normalize every section |
| [`vicnaum/linkedin-toolkit`](https://github.com/vicnaum/linkedin-toolkit) | Best current public FPE-101 request and correct target/position graph parser | Deliberately outputs a narrow identity/about/location/experience schema |
| [`alabarga/linkedin-api`](https://github.com/alabarga/linkedin-api) | Minimal direct-client structure and historical field parsing | 2018 endpoint/auth behavior is not current evidence |
| [`joeyism/linkedin_scraper`](https://github.com/joeyism/linkedin_scraper) | Playwright browser fallback and UI-derived person models | DOM scraping does not identify which Voyager response supplied each field |
| [`marostr/linkedin-voyager_api`](https://github.com/marostr/linkedin-voyager_api) | Recent Ruby transport design and cookie-supplied client pattern | Profile implementation is largely planned rather than shipped |

## Additional current references found by web research

### `devag7/linkedin-mcp`

The [endpoint builders](https://github.com/devag7/linkedin-mcp/blob/main/src/browser/endpoints.ts)
and [profile tool](https://github.com/devag7/linkedin-mcp/blob/main/src/tools/profile.ts) provide useful
TypeScript evidence for ProfileComponents section fan-out. Supported tokens include experience,
education, skills, certifications, languages, honors, projects, and volunteering.

Gap: there is no public raw current fixture proving the exact response fields.

### `gabros20/linkedin-relay`

Its [engine research](https://github.com/gabros20/linkedin-relay/blob/main/docs/ENGINE-RESEARCH.md)
reports that the legacy `profileView` endpoint now returns `410`, while the current page performs a
thin identity lookup and then section requests.

Gap: raw captures are intentionally gitignored because they contain live tokens and third-party data.

### `yashiels/linkedin-cli`

Its [API reference](https://github.com/yashiels/linkedin-cli/blob/main/API-REFERENCE.md) provides a
fresh operation catalog, including initial, deferred, batch-card, component-by-section, and paged-list
operations.

Gap: its profile parser assumptions and synthetic tests are not strong enough to be a current field contract.

## Ready-made code we can reuse conceptually

1. `vicnaum/lnx/browser/fetch_profile.js` — immediate browser-console core-profile experiment.
2. `vicnaum/lnx/api/normalize.py` — safe target and experience graph traversal.
3. `mguttmann/mcp/lib/client.py` — request/session behavior and status classification.
4. `devag7/src/browser/endpoints.ts` — current TypeScript section request shapes.
5. `joeyism` — Playwright fallback if direct reads cannot cover a visible section.

Before copying implementation code rather than reimplementing an algorithm, verify the relevant
repository license and attribution requirements.

