# Decisions and open questions

> **Status (updated 2026-08-31).** **Both decisions here were reversed.** Browserless transport became canonical, not a 'later experiment', and replaying reads inside the browser context was abandoned. Kept as the record of what was believed before the evidence arrived.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


## Decisions already made

1. Start by replaying the exact observed Voyager read inside the authenticated browser context.
2. Treat stateless Node/browserless transport as a later experiment, not the canonical first probe.
3. Resolve normalized data strictly from the requested target's graph.
4. Keep raw captures local and gitignored.
5. Maintain our own stable response schema rather than exposing LinkedIn's internal types directly.
6. Do not choose a hosting platform until the direct calls and required section count are known.

## Current hypotheses

| Hypothesis | Current basis | Test |
|---|---|---|
| A core profile route returns identity/about/location/experience | April FPE-101 parser plus August GraphQL captures | Replay the current page's observed core GET |
| Education may be referenced in the core graph | FPE-101 documented example | Inspect target references and reachable entities |
| Skills/certifications/languages are separate component calls | Fresh TypeScript section builders | Capture browser network when opening each section |
| Current page uses multiple profile calls | August 2026 capture inventories | Compare live page network with core probe |
| Stateless browserless requests work from our machine | Conflicting maintainer evidence; some report edge redirects | Test only after browser-context capture succeeds |

## Open questions blocking the hosted API

- Which decoration does our current LinkedIn page use?
- Which challenge fields are returned by the core response?
- Which fields require ProfileComponents/ProfileCards calls?
- What pagination mechanism do section-detail calls use?
- Are profile and cover image vectors present in the core response?
- How does the session distinguish restricted profile `403` from invalid-session `403`?
- Does a direct request work from the eventual cloud network?
- Is Playwright necessary for any required field?

## Decision gate after the first capture

```text
Core response covers every required field
  → build one-call normalizer and test cloud hosting

Core response misses fields but direct component calls cover them
  → build multi-call normalizer and test cloud hosting

Required visible fields need browser interaction
  → use a normal host with Playwright fallback
```

## Definition of “ready to build the API”

We are ready when we have:

- at least one sanitized core response shape;
- a source route for every required field;
- known error behavior for invalid URL, missing profile, expired session, forbidden profile, and rate limiting;
- a versioned internal output schema;
- offline fixtures covering every parser path.
