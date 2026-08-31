# Test profile set (regression fixtures)

> Fixtures are named for what they **exercise**, not for whose profile they are — the captures
> hold real people's data, so nothing identifying ships. There are deliberately no links here:
> the real handles live in `captures/HANDLES.md`, which is inside the gitignored `captures/`
> directory and never leaves your machine. Re-capture from there.

Six real profiles chosen so that **between them they exercise every code path** (five have saved captures; see #6) in
`src/profile-graph.mjs`. Captured 2026-08-30, 1 request each.

Use them to detect breakage: if LinkedIn rotates a decoration, renames a field, or changes a
collection shape, at least one of these six changes its numbers.

> **Data handling.** Raw responses live in `captures/` which is **gitignored** — a profile
> response is personal data even when the profile is publicly viewable. This file records only
> public handles and *structural counts*, never profile content. Do not commit `raw.json`.
> Re-capture locally instead; the handles below are all that is needed.

---

## The set

| # | handle | why it is in the set |
|---|---|---|
| 1 | `deep-history` | **both truncation caps at once** + publications/honors/volunteering |
| 2 | `truncated-and-unresolved` | **patents**, skills truncation, richest certifications/honors |
| 3 | `unresolved-media` | **about**, languages, **courses**, **organizations** |
| 4 | `complete-at-cap` | **exact-cap boundary** (10/10 position groups) — must NOT read as truncated |
| 5 | `sparse` | sparse account — empty arrays, no crash |
| 6 | `near-empty` | near-empty test account. ⚠️ **No capture on disk** — probed live but never saved, so the tests below run against **5** fixtures, not 6 |

## Expected structure (2026-08-30 baseline)

`total/returned cap` — `total` is LinkedIn's own count, `returned` is what arrived.

### 1. deep-history — 202,243 B · 170 records · about ✓
```
PositionGroups        12/10  cap10   ⚠️ TRUNCATED
Skills                36/20  cap20   ⚠️ TRUNCATED
Publications          13/13  cap20
Educations             8/8   cap20
Honors                 8/8   cap20
Languages              2/2   cap20
Certifications         1/1   cap20
VolunteerExperiences   1/1   cap20
```
**The only fixture that truncates position groups.** If this ever reports `complete`, the
truncation detector is broken.

### 2. truncated-and-unresolved — 195,681 B · 169 records · about ✓ · location `Ireland`
```
Skills                29/20  cap20   ⚠️ TRUNCATED
Certifications        10/10  cap20
Honors                10/10  cap20
TreasuryMediaProfile   8/2   cap10   ⚠️ UNRESOLVED
Patents                7/7   cap20
PositionGroups         7/7   cap10
VolunteerExperiences   5/5   cap20
Educations             5/5   cap20
Languages              4/4   cap20
Publications           1/1   cap20
```
**The only fixture with patents.** Also proves `unresolved` is not an Influencer artifact —
this is an ordinary account. Its `TreasuryMediaProfile 8/2` and pearl's `10/0` are the **only**
collections on any fixture that reach the `unresolved` state, which is why `featuredMedia` is
tracked in `meta.collections` even though it is not an output field: without it the unresolved
detector was implemented, documented and never once exercised by real data.

### 3. unresolved-media — 76,308 B · 88 records · about ✓
```
Courses                8/8   cap20
PositionGroups         6/6   cap10
Skills                15/15  cap20
Educations             2/2   cap20
Languages              2/2   cap20
Organizations          1/1   cap20
TreasuryMediaProfile  10/0   cap10   ⚠️ UNRESOLVED
```
**The only fixture with courses and organizations.** Verifies `Organization.positionHeld`
(NOT `position`) and the `occupation.*profileEducation → schoolName` institution join.
About text: **964 chars, 0 newlines** — see *Known non-bugs*; this is NOT a general rule.

### 4. complete-at-cap — 92,208 B · 104 records · about ✗
```
PositionGroups        10/10  cap10   ← sits EXACTLY on the cap
Skills                14/14  cap20
Certifications         3/3   cap20
Educations             1/1   cap20
```
**Boundary case.** `total === returned === cap`. Must classify as `complete`; an
off-by-one in the detector shows up here first. `about` and `languages` are genuinely absent —
confirmed against ground truth, so empty here is *correct output*, not a parse failure.

### 5. sparse — 13,453 B · 21 records
```
Educations             1/1   cap20
```
Sparse: no experience, no skills, no about. Must return empty arrays and `state: complete`.

### 6. near-empty — near-empty
```
PositionGroups         1/1   cap10
```
Purpose-built LinkedIn test account. Smallest response that still parses.

---

## Coverage matrix

| section | 1 deep-history | 2 anna | 3 pearl | 4 meet | 5 sparse |
|---|:--:|:--:|:--:|:--:|:--:|
| experience | ⚠️12 | 7 | 6 | 10 | — |
| education | 8 | 5 | 2 | 1 | 1 |
| skills | ⚠️36 | ⚠️29 | 15 | 14 | — |
| about | ✓ | ✓ | ✓ | — | — |
| languages | 2 | 4 | 2 | — | — |
| certifications | 1 | 10 | — | 3 | — |
| honors | 8 | 10 | — | — | — |
| publications | 13 | 1 | — | — | — |
| **patents** | — | **7** | — | — | — |
| volunteering | 1 | 5 | — | — | — |
| **courses** | — | — | **8** | — | — |
| **organizations** | — | — | **1** | — | — |
| truncated | ✓✓ | ✓ | — | — | — |
| unresolved (featuredMedia) | — | ✓ 2/8 | ✓ 0/10 | — | — |

**Still uncovered by any fixture:** `projects`, `testScores`. Never seen populated.

---

## Verify in the browser

Open a profile and count against the table. What to look at:

1. **deep-history** → the Experience card. Click **"Show all … experiences"**.
   The API says **12**; the single-request response carries **10**. If the page shows 12,
   truncation is confirmed independently of LinkedIn's own `paging.total`.
2. Same profile → **"Show all 36 skills"**. We return 20.
3. **truncated-and-unresolved** → Patents section (7) and "Show all 29 skills".
4. **complete-at-cap** → Experience should show exactly **10** — the cap boundary.

> Note the cap is on position **groups**, not roles: several roles at one company collapse into
> one group, so the page's role count can exceed the group count. Compare *companies*.

## Known non-bugs

- **About text and newlines.** `unresolved-media`'s About returns 0 newlines where the rendered page
  shows paragraphs. **This is NOT a general API property** — `truncated-and-unresolved`'s summary carries
  **11 newlines** intact. Earlier versions of these docs asserted that the Voyager read collapses
  `\n\n` as a structural rule, and told the reader not to investigate; that generalised from a
  single profile. Pearl's case is unexplained. Do not rely on newlines being either preserved or
  stripped.

## Re-capture

```bash
for h in deep-history truncated-and-unresolved unresolved-media complete-at-cap \
         sparse near-empty; do
  node profile.mjs "$h"; sleep 3
done
```
Pace at ≥1 s (measured-safe is 1.0 s + jitter). Six profiles is well inside any observed
envelope, but **never** re-run this in a loop to "check for flakiness" — a 429 costs far more
than the test is worth.
