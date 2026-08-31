# LinkedIn profile backend model

> **Status (updated 2026-08-31).** Still broadly right — the profile page IS a client over session-authenticated APIs returning an entity graph. What changed: the graph comes from ONE decorated call (`identity/dash/profiles` + `FullProfileWithEntities-101`), not lazy per-section fetches. The lazy `ProfileComponents` route exists but costs 13x the requests for identical data.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


## One-sentence model

LinkedIn's profile page is a JavaScript client over private, session-authenticated APIs that return
an entity graph; the page resolves that graph and may fetch additional sections lazily.

## Request flow

```text
https://www.linkedin.com/in/jane-doe-123/
                         │
                         └── publicIdentifier = jane-doe-123
                                      │
                                      ▼
                         authenticated Voyager request
                          li_at + JSESSIONID cookies
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
          core Profile response              ProfileComponents/Cards
          identity + graph refs               sectionType: skills, etc.
                    └─────────────────┬─────────────────┘
                                      ▼
                          normalized JSON resolution
                             data + included[]
                                      ▼
                              rendered profile page
```

## Authentication

The private web API does not use an ordinary developer API key:

- `li_at` represents the logged-in session.
- `JSESSIONID` contains the CSRF value, normally beginning with `ajax:`.
- The request sends `csrf-token` with the JSESSIONID value without surrounding cookie quotes.
- `x-restli-protocol-version: 2.0.0` and the normalized-JSON Accept header are commonly required.

“Browserless” means the browser creates the authenticated session once, after which a plain HTTP
client reuses the cookies. It does **not** mean unauthenticated access.

## Core REST.li profile request

A documented request family is:

```text
GET /voyager/api/identity/dash/profiles
  ?q=memberIdentity
  &memberIdentity=<public identifier>
  &decorationId=<profile projection>
```

`memberIdentity` answers “which person?” A decoration answers “which server-defined response
projection?” Decorations are internal implementation details. Public sources currently reference
multiple versions (`FullProfile-76`, `FullProfileWithEntities-96`, `-101`, and `-109`), so no version
should be treated as universal.

## Normalized JSON and URNs

The response is a small graph database:

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

The safe resolution algorithm is:

1. Index `included[]` by `entityUrn`.
2. Resolve the target strictly through `data["*elements"][0]`.
3. Walk references outward from that target.
4. Never collect every `Position`, `Education`, or other type globally; supporting entities can
   belong to another profile.
5. Treat absent referenced entities as unresolved rather than inventing a value.

## Lazy profile sections

Current public code and capture inventories show additional request families:

- `voyagerIdentityDashProfileComponents`
- `voyagerIdentityDashProfileCards`
- section tokens including `experience`, `education`, `skills`, `certifications`, `languages`,
  `honors`, `projects`, and `volunteering`

This suggests that the modern page can use a thin core response plus section fan-out. A live capture
is required to determine which fields our authenticated session receives from each route.

## Expected error meanings

- `200` — JSON returned; it may still be partial.
- `302` or another login redirect — session probably expired or malformed.
- `403` — restricted target, invalid session, or denied request.
- `404` — route, decoration, persisted-query hash, or profile may be stale/missing.
- `429` — stop immediately and wait; do not retry in a loop.

Sources: [mguttmann overview](https://github.com/mguttmann/linkedin-internal-api/blob/main/docs/00-OVERVIEW.md), [vicnaum endpoint reference](https://github.com/vicnaum/linkedin-toolkit/blob/main/references/endpoints.md).

