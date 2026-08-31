// THE SINGLE DECLARATION OF THE API'S OUTPUT SHAPE. Add a field HERE and nowhere else.
//
// This describes the NESTED profile object -- the only shape the API returns. A flat
// one-row-per-profile rendering used to exist alongside it; it was removed 2026-08-31 because a
// JSON API does not need a CSV shape, and maintaining two renderings of one data model meant
// every new field had to be added twice.
//
// The declaration previously covered only the flat shape, which left the DEFAULT response
// undeclared and unchecked. It now covers what actually ships.
//
//   node tools/schema.mjs           list every field
//   node tools/schema.mjs check     fail if the parser and this file disagree
//   node tools/schema.mjs docs      regenerate docs/SCHEMA.md
//
// `item` lists the keys of each element in a list field. Those names are taken from the parsed
// output, not guessed -- honors and patents use `title` where everything else uses `name`, and
// Organization's role is `positionHeld`. Guessing there produced silent nulls once already.
export const FIELDS = [
  { key: 'publicIdentifier', group: 'identity', type: 'string', label: "Public slug", source: "Profile.publicIdentifier" },
  { key: 'profileId', group: 'identity', type: 'string', label: "Member id", source: "data[\"*elements\"][0] tail" },
  { key: 'url', group: 'identity', type: 'string', label: "Profile URL", source: "derived from publicIdentifier" },
  { key: 'name', group: 'identity', type: 'string', label: "Full name", source: "Profile.firstName + lastName" },
  { key: 'firstName', group: 'identity', type: 'string', label: "First name", source: "Profile.firstName" },
  { key: 'lastName', group: 'identity', type: 'string', label: "Last name", source: "Profile.lastName" },
  { key: 'headline', group: 'identity', type: 'string', label: "Headline", source: "Profile.headline" },
  { key: 'about', group: 'identity', type: 'string|null', label: "About / summary", source: "Profile.summary" },
  { key: 'location', group: 'identity', type: 'string', label: "Location", source: "geoLocation[\"*geo\"] → Geo.defaultLocalizedName (**not** locationName, which is null)" },
  { key: 'countryCode', group: 'identity', type: 'string', label: "Country code", source: "Profile.geoCountryUrn tail / geoLocation country" },
  { key: 'industry', group: 'identity', type: 'string|null', label: "Industry", source: "Profile[\"*industry\"] -> Industry.name" },
  { key: 'premium', group: 'identity', type: 'boolean', label: "Premium subscriber", source: "Profile.premium" },
  { key: 'memberDistance', group: 'identity', type: 'string|null', label: "Network distance", source: "memberRelationship — needs enrich=social" },
  { key: 'connectionDegree', group: 'identity', type: 'string|null', label: "Connection degree", source: "urn:li:fsd_memberRelationship:<profileId> → memberRelationshipUnion.<branch>.memberDistance" },
  { key: 'photoFilterType', group: 'identity', type: 'string|null', label: "Photo filter", source: "profilePicture.photoFilterEditInfo.photoFilterType (NOT profilePicture.photoFilterType)" },
  { key: 'profilePicture', group: 'identity', type: 'string|null', label: "Profile image URL", source: "profilePicture.displayImageReference.vectorImage → rootUrl + widest artifact" },
  { key: 'profilePictureUrn', group: 'identity', type: 'string|null', label: "Profile image URN", source: "profilePicture.displayImageUrn" },
  { key: 'coverImage', group: 'identity', type: 'string|null', label: "Cover image URL", source: "backgroundPicture displayImageReference -> vectorImage rootUrl + widest artifact, or a plain {url}" },
  { key: 'coverImageUrn', group: 'identity', type: 'string|null', label: "Cover image URN", source: "backgroundPicture displayImageReference URN" },
  { key: 'experience', group: 'sections', type: 'array', label: "Positions, every one — not just the two most recent", source: "*profilePositionGroups → CollectionResponse[\"*elements\"] → PositionGroup → Position", item: ["title","company","companySlug","companyLinkedinUrl","companyIndustry","employmentType","dates","location","description","companyUrl"] },
  { key: 'education', group: 'sections', type: 'array', label: "Schools", source: "*profileEducations → Education", item: ["school","schoolLinkedinUrl","schoolSlug","degree","fieldOfStudy","grade","activities","dates","description"] },
  { key: 'skills', group: 'sections', type: 'array', label: "Skills (endorsement counts need enrich=endorsements)", source: "*profileSkills → Skill.name", item: ["name"] },
  { key: 'certifications', group: 'sections', type: 'array', label: "Licences and certifications", source: "*profileCertifications → Certification", item: ["name","authority","url","dates"] },
  { key: 'languages', group: 'sections', type: 'array', label: "Languages", source: "*profileLanguages → Language (proficiency is an ENUM, not the UI string)", item: ["name","proficiency"] },
  { key: 'courses', group: 'sections', type: 'array', label: "Courses", source: "*profileCourses → Course", item: ["name","number","institution"] },
  { key: 'projects', group: 'sections', type: 'array', label: "Projects", source: "*profileProjects → Project", item: ["name","description","dates"] },
  { key: 'honors', group: 'sections', type: 'array', label: "Honours and awards", source: "*profileHonors → Honor (field is `title`, NOT `name`)", item: ["title","issuer","description"] },
  { key: 'publications', group: 'sections', type: 'array', label: "Publications", source: "*profilePublications → Publication", item: ["name","publisher","description"] },
  { key: 'patents', group: 'sections', type: 'array', label: "Patents", source: "*profilePatents → Patent (field is `title`, NOT `name`)", item: ["title","number"] },
  { key: 'organizations', group: 'sections', type: 'array', label: "Organizations", source: "*profileOrganizations → Organization (role is `positionHeld`, NOT `position`)", item: ["name","positionHeld","dates","institution","description"] },
  { key: 'volunteering', group: 'sections', type: 'array', label: "Volunteering", source: "*profileVolunteerExperiences → VolunteerExperience", item: ["role","organization","cause","description","dates"] },
  { key: 'testScores', group: 'sections', type: 'array', label: "Test scores", source: "*profileTestScores → TestScore", item: ["name","score","description"] },
];

export const KEYS       = FIELDS.map((f) => f.key);
export const GROUPS     = [...new Set(FIELDS.map((f) => f.group))];
export const SECTIONS   = FIELDS.filter((f) => f.type === 'array').map((f) => f.key);
export const byKey      = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Not obtainable, declared with a reason rather than emitted as a null -- a null would read as
// "this person has none", which is a different claim from "we cannot get this".
export const UNAVAILABLE = {
  professionalEmail: { reason: 'not LinkedIn data. Scrapers that return it buy it from enrichment vendors (Dropcontact, Hunter); it is never fabricated here.' },
};

// Fields the single profile request cannot fill. Each names the ?enrich= flag that fills it,
// at the cost of ONE additional upstream request.
export const ENRICHMENT = {
  memberDistance:   'social',
  connectionDegree: 'social',
};
