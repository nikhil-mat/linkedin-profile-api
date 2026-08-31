# Schema — the shape the API returns

**Generated from `src/schema.mjs`. Do not edit by hand** — run `node tools/schema.mjs docs`.

There is **one** output shape: the nested profile object. 32 fields —
19 scalars and 13 lists — all from a **single**
upstream request unless marked otherwise.

| | meaning |
|---|---|
| ✅ | comes from the single profile request |
| ➕ | needs an enrichment: one additional upstream request, never implicit |

## Scalars

| field | type | means | cost | source in the payload |
|---|---|---|---|---|
| `publicIdentifier` | `string` | Public slug | ✅ the single request | Profile.publicIdentifier |
| `profileId` | `string` | Member id | ✅ the single request | data["*elements"][0] tail |
| `url` | `string` | Profile URL | ✅ the single request | derived from publicIdentifier |
| `name` | `string` | Full name | ✅ the single request | Profile.firstName + lastName |
| `firstName` | `string` | First name | ✅ the single request | Profile.firstName |
| `lastName` | `string` | Last name | ✅ the single request | Profile.lastName |
| `headline` | `string` | Headline | ✅ the single request | Profile.headline |
| `about` | `string\|null` | About / summary | ✅ the single request | Profile.summary |
| `location` | `string` | Location | ✅ the single request | geoLocation["*geo"] → Geo.defaultLocalizedName (**not** locationName, which is null) |
| `countryCode` | `string` | Country code | ✅ the single request | Profile.geoCountryUrn tail / geoLocation country |
| `industry` | `string\|null` | Industry | ✅ the single request | Profile["*industry"] -> Industry.name |
| `premium` | `boolean` | Premium subscriber | ✅ the single request | Profile.premium |
| `memberDistance` | `string\|null` | Network distance | ➕ `?enrich=social` | memberRelationship — needs enrich=social |
| `connectionDegree` | `string\|null` | Connection degree | ➕ `?enrich=social` | urn:li:fsd_memberRelationship:<profileId> → memberRelationshipUnion.<branch>.memberDistance |
| `photoFilterType` | `string\|null` | Photo filter | ✅ the single request | profilePicture.photoFilterEditInfo.photoFilterType (NOT profilePicture.photoFilterType) |
| `profilePicture` | `string\|null` | Profile image URL | ✅ the single request | profilePicture.displayImageReference.vectorImage → rootUrl + widest artifact |
| `profilePictureUrn` | `string\|null` | Profile image URN | ✅ the single request | profilePicture.displayImageUrn |
| `coverImage` | `string\|null` | Cover image URL | ✅ the single request | backgroundPicture displayImageReference -> vectorImage rootUrl + widest artifact, or a plain {url} |
| `coverImageUrn` | `string\|null` | Cover image URN | ✅ the single request | backgroundPicture displayImageReference URN |

## Lists

Every one is returned **in full** — every position, not just the two most recent. `meta.collections`
reports `complete` / `truncated` / `unresolved` per list, because LinkedIn caps them server-side
without saying so and `paging.total` is the only discriminator.

| field | means | item shape | source in the payload |
|---|---|---|---|
| `experience` | Positions, every one — not just the two most recent | `{ title, company, companySlug, companyLinkedinUrl, companyIndustry, employmentType, dates, location, description, companyUrl }` | *profilePositionGroups → CollectionResponse["*elements"] → PositionGroup → Position |
| `education` | Schools | `{ school, schoolLinkedinUrl, schoolSlug, degree, fieldOfStudy, grade, activities, dates, description }` | *profileEducations → Education |
| `skills` | Skills (endorsement counts need enrich=endorsements) | `{ name }` | *profileSkills → Skill.name |
| `certifications` | Licences and certifications | `{ name, authority, url, dates }` | *profileCertifications → Certification |
| `languages` | Languages | `{ name, proficiency }` | *profileLanguages → Language (proficiency is an ENUM, not the UI string) |
| `courses` | Courses | `{ name, number, institution }` | *profileCourses → Course |
| `projects` | Projects | `{ name, description, dates }` | *profileProjects → Project |
| `honors` | Honours and awards | `{ title, issuer, description }` | *profileHonors → Honor (field is `title`, NOT `name`) |
| `publications` | Publications | `{ name, publisher, description }` | *profilePublications → Publication |
| `patents` | Patents | `{ title, number }` | *profilePatents → Patent (field is `title`, NOT `name`) |
| `organizations` | Organizations | `{ name, positionHeld, dates, institution, description }` | *profileOrganizations → Organization (role is `positionHeld`, NOT `position`) |
| `volunteering` | Volunteering | `{ role, organization, cause, description, dates }` | *profileVolunteerExperiences → VolunteerExperience |
| `testScores` | Test scores | `{ name, score, description }` | *profileTestScores → TestScore |

## Not obtainable

Declared with a reason rather than emitted as `null` — a null would read as "this person has
none", which is a different claim from "we cannot get this".

| field | why |
|---|---|
| `professionalEmail` | not LinkedIn data. Scrapers that return it buy it from enrichment vendors (Dropcontact, Hunter); it is never fabricated here. |
