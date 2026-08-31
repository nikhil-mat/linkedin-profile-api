# Profile field evidence map

> **Status (updated 2026-08-31).** The caveat here — that the field set is not stable or publicly knowable — remains the single most useful idea in this file, and every later bug proved it. Concrete coverage is now measured against PhantomBuster's 51-field schema: **50 obtainable**.
> Current position: [README.md](../../README.md) · [API](../API.md) · [OPERATIONS](../OPERATIONS.md) · [BUILD](../BUILD.md)


## Important limitation

“All possible LinkedIn fields” is not a stable, publicly knowable set. Fields vary with deployment,
viewer relationship, locale, privacy, profile contents, experiments, pagination, and requested route.

Our defensible target is:

> Every challenge-relevant field observable by our authenticated session through the profile routes
> the current LinkedIn page actually loads.

## Evidence table

| Surface | Candidate fields | Current evidence |
|---|---|---|
| Identity | public identifier, profile URN, first/last name, headline, location | Confirmed core |
| About | summary/AttributedText | Confirmed core |
| Experience | title, company, dates, location, description | Confirmed core graph |
| Education | school, degree, field, dates, grade, activities, description | Core reference + confirmed component route; exact keys unverified |
| Skills | name, endorsements, associated experience/education | Confirmed component route; exact keys unverified |
| Certifications | name, issuer, dates, credential ID/URL, skills, media | Confirmed component route + UI field inventory |
| Languages | name, proficiency | Confirmed component route; exact keys unverified |
| Profile/cover images | vector root, artifacts, dimensions, final URLs | Known UI/data convention; placement needs capture |
| Projects | name, description, dates, URL, position, skills, contributors, media | Confirmed component route + UI inventory |
| Volunteering | organization, role, cause, dates, description, media | Confirmed component route + UI inventory |
| Honors | title, issuer, date, description, associated entity | Confirmed component route; partial capture evidence |
| Courses | name, number, associated experience/education | Known UI surface |
| Publications | title, publisher, date, URL, description, coauthors | Known UI surface |
| Organizations | organization, position, dates, description, associated entity | Known UI surface |
| Recommendations | author, relationship, text, date, direction | Known UI surface; likely separate/paginated |
| Contact information | websites, email, phone, address, birthday, social handles | Separate and viewer-dependent; legacy direct endpoint reported `410` |
| Open to Work | visibility, role/location URNs, remote preference | Separate documented response |
| Other | patents, test scores, featured, services, causes, career breaks | Known UI surfaces; read mappings incomplete |

## How we will discover fields

For every captured response, record two different schemas:

1. **Potential schema** from `meta.microSchema`, when present.
2. **Observed schema** from the union of keys on target-reachable `included[]` entities.

The live coverage report stores:

```text
decoration/query ID
target profile URN
target Profile direct keys
target Profile *references
target-reachable entities and paths
$type → observed key union
unresolved references
microSchema presence and raw body
```

One profile cannot exercise every optional field. After the first capture, use a small, authorized
set of representative profiles:

- own profile;
- visible profile containing most sections;
- ordinary sparse profile;
- restricted or nonexistent profile for error behavior.

Then merge the observed schemas while preserving the source route and capture date. Do not mix old
endpoint models, browser-only text, and current Voyager evidence without labeling them.

## Definition of success for the challenge

The final output should cover the explicit requirements first:

- name;
- headline;
- location;
- about;
- experience;
- education;
- skills;
- certifications;
- languages;
- profile images when available.

Additional surfaces are valuable only after these fields are reliable.

