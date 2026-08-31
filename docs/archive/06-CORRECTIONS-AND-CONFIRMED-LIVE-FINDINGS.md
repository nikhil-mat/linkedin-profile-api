# Corrections and confirmed live findings

> **Status (updated 2026-08-31).** Its corrections were real, but the architecture it confirmed (React Flight decoding) was itself superseded the same day. Read `LEARNED-02` §3 for the full incident list — including the ones that came after this file was written.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


Date: 2026-08-30

This note records what went wrong during the first live Chrome probe, the evidence that corrected it,
and the current ground truth. It exists so we do not repeat the same assumptions.

## What we got wrong

### 1. `chrome-extension://invalid/` was blamed on an installed extension

That was incorrect. Chrome reported no installed extensions in the connected profile, and the local
LinkedIn bundle shows LinkedIn generating the requests itself.

The downloaded bundle is:

```text
grbage/bnmc4331fne8fm9kp3n6mnwn0.js
```

It contains:

- `AbuseFeaturesCollectionCoordinator`
- a large array of Chrome extension IDs and known resource paths
- `fetch(`chrome-extension://${id}/${file}`)` at approximately line 9539
- an `AedEvent` containing `browserExtensionIds` at approximately line 9545
- a second DOM scan that emits `SpectroscopyEvent`
- a Chrome user-agent check before running the detection

When a probed extension is not installed, Chrome masks the attempted extension URL as:

```text
chrome-extension://invalid/
```

Therefore, disabling the user's extensions is not the solution. LinkedIn's own anti-abuse or
extension-detection code produces the noise.

### 2. Filtering Network output was treated as sufficient

Filtering the returned text hides the invalid lines, but it does not solve the actual problem.
Chrome DevTools MCP retained only 1,000 recent requests during this experiment. LinkedIn generated
enough invalid extension probes to evict genuine LinkedIn requests before they could be inspected.

Chrome DevTools MCP documents `--blocked-url-pattern`, and the installed implementation passes these
patterns to Chrome's CDP network-emulation rules. We configured:

The intended MCP argument is:

```text
--blocked-url-pattern=chrome-extension://*/*
```

The pattern itself matches both real `chrome-extension://<ID>/<FILE>` URLs and Chrome's masked
`chrome-extension://invalid/` representation. However, a live test after restarting showed that blocked
attempts are still emitted as failed DevTools Network events. They therefore remain visible to
`list_network_requests` and can still fill its 1,000-entry history.

This option changes whether a request is delivered; it does not provide the URL-filtered Network-event
buffer needed here. Treating it as a complete logging solution was another incorrect assumption.

### 3. Page-injected `fetch` interception was treated as equivalent to DevTools interception

It is not equivalent. The automation initialization script ran in a different execution context from
LinkedIn's application bundle. It could not reliably replace the `fetch` function used by LinkedIn.
The delayed extension scan therefore returned and filled the Network buffer.

Page JavaScript is not a reliable interception layer, and MCP URL blocking does not remove attempted
requests from the MCP Network history. For the current experiment, the reliable workaround was to
reload and collect same-origin requests immediately, in the same operation, before LinkedIn's delayed
extension scan filled the buffer.

### 4. The first profile GraphQL request was misidentified as the target profile payload

The observed request was:

```text
/voyager/api/graphql
queryId=voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a
variables=(memberIdentity:...)
```

Comparing its `memberIdentity` with `/voyager/api/me` proved that the ID belongs to the logged-in
viewer. The viewed profile exposes a different internal profile ID. This GraphQL request is current-user
or global initialization in this page load; it is not the viewed person's complete profile response.

Its response contained only a profile entity URN and `versionTag`, not the target profile's sections.

## Confirmed current model

The tested profile uses LinkedIn's newer server-driven UI (SDUI) profile surface.

An authenticated GET of the profile URL returned approximately 920 KB of HTML containing the target
profile name and internal target profile ID. The rendered page exposes stable-looking SDUI card IDs,
including:

```text
Topcard
About
Featured
Activity
ExperienceTopLevelSection
EducationTopLevelSection
CertificationTopLevel
Projects
VolunteerExperienceTopLevel
SupportedLocales
```

The profile screen itself is marked as:

```text
data-sdui-screen="com.linkedin.sdui.flagshipnav.profile.Profile"
```

Card containers follow a pattern similar to:

```text
com.linkedin.sdui.profile.card.ref<TARGET_ID><CARD_NAME>
```

These semantic card identifiers are better parsing anchors than LinkedIn's hashed CSS class names.

Some cards are present in the initial HTML, while experience and education appeared later in the live
DOM. The subsequent clean capture identified `/flagship-web/rsc-action` as the profile-component
transport. The complete mapping between individual RSC records and each later card remains unfinished.

## Confirmed profile transport: RSC actions

## Cross-check against `mguttmann/linkedin-internal-api`

The reference repository was not missing the endpoint names. Its README describes the two backend
worlds and explicitly gives SDUI's `/flagship-web/rsc-action/` base path. Its
`docs/03-SDUI-API.md` and `docs/23-READ-DISCOVERY.md` list the same profile component identifiers:

```text
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
com.linkedin.sdui.requests.profile.fetchProfileDiscoveryDrawer
com.linkedin.sdui.requests.profile.profilePolicyNotice
```

It also lists `voyagerIdentityDashProfiles` query-id variants as profile top-card reads.

What that repository does not provide is a complete public-profile scraper for the current page. It is
primarily an account-owner automation/reference client: its profile coverage focuses on profile edits,
browserless reads, and an endpoint/action catalog. The profile component names are recorded as
discovered actions, but their target-profile request body, `vieweeProfileId`/`vanityName` payload,
`profileComponentState` bindings, React Flight response decoding, and field-level card mapping are not
documented there.

Therefore our new evidence is an expansion of that repo's catalog, not a contradiction of it. The repo
gave us the names of the RSC components; this experiment established how those components are invoked
for a public viewed profile and what must still be decoded for a scraper response.

An immediate same-operation reload and capture identified the viewed-profile transport. LinkedIn posts
profile component requests to:

```text
POST /flagship-web/rsc-action/actions/component
```

Two profile component IDs were observed:

```text
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity
com.linkedin.sdui.generated.profile.dsl.impl.profileCardsActivity
```

The `profileCardsAboveActivity` request body is JSON with the following important structure:

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
        "...": "MemoryNamespace binding objects"
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

The `profileCardsActivity` request is smaller:

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

Request content type is `application/json`. Response content type is `application/octet-stream`.
The response is a newline-delimited React Flight/RSC stream, not ordinary profile JSON. It begins with
module/import records such as `I[...]`, followed by component-tree records such as `0:[...]`. The tree
contains semantic markers including:

```text
data-sdui-component
componentKey
com.linkedin.sdui.profile.card.ref<TARGET_PROFILE_ID><CARD_NAME>
```

For example, the observed `profileCardsAboveActivity` response contained the component marker
`com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity` and a profile-card reference
ending in `SalesInsightsOrHighlights` within the captured prefix.

This is the most important current correction: the viewed profile is transported as server-rendered
React/SDUI component data through `/flagship-web/rsc-action`, not as one normalized
`voyagerIdentityDashProfiles` response.

## What is no longer assumed

We must not currently assume that:

- one `voyagerIdentityDashProfiles` request returns the complete viewed profile
- every profile section is loaded from `/voyager/api/`
- normalized Voyager `included[]` is the only current profile representation
- hashed CSS classes are safe parsing selectors
- a browser extension installed by the user causes the invalid request flood

## Next clean experiment

1. Capture the `profileCardsAboveActivity` and `profileCardsActivity` calls immediately after reload.
2. Preserve their complete `application/octet-stream` response bodies outside the 10,000-character
   inline display limit.
3. Decode or parse the React Flight records into an inspectable component tree.
4. Map SDUI card names and component content to the required challenge fields.
5. Determine whether detail-only sections such as skills and languages use additional RSC actions.
6. Test the same component IDs and payload shape against profiles with different populated sections.
7. Document stable request requirements and parsing anchors before writing the API.

## Evidence boundaries

- These observations come from one authenticated Chrome session and one public profile on
  2026-08-30.
- LinkedIn query hashes and frontend bundles are deploy-specific and may change.
- The semantic SDUI identifiers look substantially more useful than CSS classes, but still require
  testing against several profiles with different missing and populated sections.
- No cookies, CSRF values, or full authentication headers should be committed or printed.
- The hosted API has not been built. This remains a local reverse-engineering and documentation phase.
