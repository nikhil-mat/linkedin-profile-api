# Local Voyager probe

> **Status (updated 2026-08-31).** **Overturned.** This advised against the stateless Node probe as a first live test. Browserless requests turned out to be the ONLY viable transport: two cookies, no browser in the request path. The browser is needed only to mint cookies. What this file got right by accident: local egress does matter — but because a DATACENTER IP invalidates a session, not because statelessness is a problem.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


## Audit verdict

Do **not** use the stateless Node probe as the first live test.

Three independent static audits found that its legacy REST request is syntactically valid, but:

- a Node/Undici TLS and header fingerprint may be challenged even with valid cookies;
- `FullProfileWithEntities-101` is April 2026 evidence, while later captures use a GraphQL profile contract;
- guessing additional decorations or automatically falling back would create unnecessary requests.

The safe first test is therefore **browser-context discovery and one explicit replay, as GET, of an
allowlisted core-profile URL observed on the current LinkedIn page**. Resource Timing shows the URL
and response sizes, but not the original HTTP method; the allowlist is what makes GET replay safe.

## Safety rules

- Use your own profile and session for the first capture.
- Never paste cookies into chat, code, logs, screenshots, or documentation.
- Treat the downloaded response as personal data.
- Stop immediately on HTTP `429` or `999`.
- Make no automatic retries, decoration fallbacks, or component fan-out.
- Do not share the raw capture; share only the locally generated coverage report if needed.

## Step 1 — run offline tests

```bash
npm test
```

The tests cover strict URL validation, target identity, duplicate URNs, GraphQL and REST roots,
foreign-Profile graph boundaries, and resolved/unresolved section reporting. They make no network call.

## Step 2 — install the browser snippet without making a request

1. In Chrome, open your own `https://www.linkedin.com/in/.../` profile.
2. Open DevTools → **Sources** → **Snippets**.
3. Create a snippet and paste the contents of `browser-probe.js`.
4. Run the snippet.

Installing it makes zero requests. The console should say:

```text
Installed window.linkedInProfileProbe. No request was sent.
```

Sanitized debug logging is enabled by default. Debug entries are prefixed with
`[linkedin-profile-probe]` and show only stage names, counts, sizes, status codes and validation
booleans. They never include cookies, CSRF values, complete URLs, GraphQL variables, raw JSON or full
URNs. Debugging can be toggled with:

```js
linkedInProfileProbe.setDebug(false)
linkedInProfileProbe.setDebug(true)
```

## Step 3 — discover what the page already requested

In the DevTools Console:

```js
linkedInProfileProbe.discover()
```

This reads the browser's Resource Timing list. It does not contact LinkedIn. It lists only allowlisted
core profile GET candidates matching the profile currently open.

If nothing appears, leave DevTools open, reload your profile, and run `discover()` again.

Candidates are sorted by `decodedBodySize` descending because one page can emit several matching
DashProfiles projections. The largest response is a useful selection heuristic, not a contract.

Review the table. We expect either:

- `GRAPHQL_PROFILE` with a `voyagerIdentityDashProfiles.<hash>` query ID; or
- `REST_PROFILE` with a captured decoration ID.

Do not assume index `0` is correct solely because it is largest. Review its family, identity and size.

## Step 4 — replay exactly one reviewed request

If the correct candidate is index `0`:

```js
await linkedInProfileProbe.replay(0)
```

The function enforces:

- same `https://www.linkedin.com` origin;
- an allowlisted core profile path/query family;
- the public identifier of the page currently open;
- GET only, no body and no `action` parameter;
- browser-managed cookies and actual browser network fingerprint;
- redirect failure and no fallback;
- immediate stop on `429` or `999`;
- JSON response only.

It returns only a small summary. Raw JSON stays in memory.

Only one `replay()` attempt is permitted per snippet installation—even after an error. Reload the
page and reinstall the snippet before a separately reviewed later attempt. This prevents accidental
retries after a rate limit, challenge or ambiguous failure.

## Step 5 — download deliberately and analyze offline

Only after a successful summary:

```js
linkedInProfileProbe.download()
```

Then run locally, using the downloaded path and the same profile URL:

```bash
npm run analyze -- \
  "$HOME/Downloads/linkedin-profile-capture-123456789.json" \
  "https://www.linkedin.com/in/your-profile-id/"
```

The analyzer immediately changes the downloaded raw file to owner-only mode `0600`. It verifies the
capture wrapper against the requested URL and, when the response echoes `publicIdentifier`, requires
that value to match as well. Some thin current projections omit `publicIdentifier`; those are labeled
`request-bound-no-response-echo` rather than falsely claiming a response echo. The analyzer refuses
duplicate URNs and will not traverse a second Profile even when referenced. It writes a unique,
owner-only coverage report under `captures/`.

## Interpreting the coverage report

- `present on target profile` — inline field exists.
- `referenced and resolved in included[]` — target points to data supplied in this response.
- `referenced but unresolved` — target points to data omitted from this response.
- `not referenced by target profile` — the core response provides no target edge for the section.
- `externalProfileReferences` — related Profiles observed but deliberately not traversed.

## Experimental Node transport

`probe.mjs` remains as a later transport experiment, but it is disabled unless
`ALLOW_EXPERIMENTAL_NODE_TRANSPORT=1` is set deliberately. It uses one legacy REST GET and performs no
fallback. It is not the recommended first live test and a redirect does not automatically mean that
the cookies are expired.

The `.env` you already created remains gitignored and mode `0600`; the browser-first workflow does
not read it.
