// Parser for the normalised `{data, included[]}` graph returned by
// identity/dash/profiles with the FullProfileWithEntities decoration.
//
// The rules here are taken from the reference repos rather than rediscovered --
// see docs/08-SYNTHESIS.md §4. The two that actually bite:
//   Q-POSITION-GRAPH-WALK: a response may carry Position records belonging to OTHER
//     profiles cited in it, so positions are reached by walking the subject's own
//     reference chain, never by filtering included[] on $type.
//   Q-MULTIPLE-PROFILES:  included[] may hold 2-3 Profile records; the subject is
//     always data.*elements[0].

// `fs_miniProfile` / `fs_profile` / `fsd_profile` coexist mid-migration. Collapse them
// so a reference minted in one namespace still resolves against the other.
export const canonicalUrn = (urn) =>
  typeof urn === 'string' ? urn.replace(/urn:li:fs_(miniProfile|profile):/, 'urn:li:fsd_profile:') : urn;

export function indexIncluded(included = []) {
  const byUrn = new Map();
  for (const rec of included) {
    if (rec?.entityUrn) byUrn.set(canonicalUrn(rec.entityUrn), rec);
  }
  return byUrn;
}

// Q-ATTRIBUTED-TEXT: text arrives as { text: "...", attributes: [] }. multiLocale* keys
// carry the same string again per locale and would duplicate every field, so they are
// never read.
export const attrText = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'object' && typeof v.text === 'string') return v.text.trim() || null;
  return null;
};

// A CollectionResponse holds its members under `*elements` as URNs. An EMPTY collection
// is shaped differently -- `elements: []` with no star and `paging.total: 0` -- so an
// absent `*elements` means "none", not "lookup failed".
export function collection(byUrn, ref) {
  const node = byUrn.get(canonicalUrn(ref));
  const urns = node?.['*elements'] ?? [];
  return urns.map(u => byUrn.get(canonicalUrn(u))).filter(Boolean);
}

// `paging.total` is authoritative for how many the member actually has. The server caps a
// collection at `paging.count` (10 for position groups, 20 for most others), so a member
// with more than the cap gets silently truncated -- returning that as a complete profile
// would be the exact "empty success" this design forbids. Report it instead.
// Three distinct states hide behind "returned < total", and collapsing them loses the
// distinction between "there is more" and "we lost some":
//   complete    total === returned
//   truncated   returned hit the server cap and more exist  -> paginate
//   unresolved  under the cap yet records still missing     -> FAILED DECORATION, not "no data"
// Seen live: williamhgates TreasuryMediaProfile total=2 returned=0 cap=10 -- nothing was
// truncated, the collection simply was not expanded.
export function pagingOf(byUrn, ref) {
  const node = byUrn.get(canonicalUrn(ref));
  if (!node) return null;
  const { total = null, count = null } = node.paging ?? {};
  const returned = (node['*elements'] ?? node.elements ?? []).length;
  if (total == null) return null;
  const state = total === returned ? 'complete'
    : (count != null && returned >= count) ? 'truncated'
    : 'unresolved';
  return { total, returned, cap: count, state,
           truncated: state === 'truncated', unresolved: state === 'unresolved' };
}

const year = (d) => d ? [d.month, d.year].filter(Boolean).join('/') : null;

// LinkedIn renders ranges as "Jun 2025 - Present"; keep that alongside the raw parts so
// consumers can have either without re-parsing.
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pretty = (d) => d ? [d.month ? MON[d.month - 1] : null, d.year].filter(Boolean).join(' ') : null;

export const dateRange = (r) => {
  if (!r) return null;
  const s = year(r.start), e = year(r.end);
  if (!s && !e) return null;
  const ps = pretty(r.start), pe = pretty(r.end);
  return { start: s, end: e, current: !!s && !r.end,
           text: [ps, pe ?? (ps ? 'Present' : null)].filter(Boolean).join(' - ') || null };
};

// Company.industry arrives as { "*urn:li:fsd_industry:43": "urn:li:fsd_industry:43" } -- a map
// keyed by the starred urn. Take the value, then resolve it in included[].
const industryName = (byUrn, node) => {
  const urn = node?.industryUrns?.[0]
    ?? (node?.industry && typeof node.industry === 'object' ? Object.values(node.industry)[0] : null);
  return attrText(byUrn.get(canonicalUrn(urn))?.name) ?? null;
};

// LinkedIn company/school pages are /company/<slug>/ and /school/<slug>/.
const slugFromUrl = (url) => {
  const m = typeof url === 'string' ? url.match(/linkedin\.com\/(?:company|school)\/([^/?#]+)/i) : null;
  return m ? m[1] : null;
};

// Experience is grouped: one PositionGroup per company, holding 1..n Positions. A single
// role still produces a group, so the group is always walked rather than special-cased.
function positions(byUrn, profile) {
  const out = [];
  for (const group of collection(byUrn, profile['*profilePositionGroups'])) {
    const company = byUrn.get(canonicalUrn(group['*company']));
    for (const p of collection(byUrn, group['*profilePositionInPositionGroup'])) {
      const empType = byUrn.get(canonicalUrn(p['*employmentType']));
      out.push({
        title: attrText(p.title),
        company: attrText(p.companyName) ?? attrText(group.companyName),
        companySlug: company?.universalName ?? slugFromUrl(company?.url) ?? null,
        companyLinkedinUrl: company?.url ?? null,     // the LinkedIn PAGE, not the company website
        companyIndustry: industryName(byUrn, company),
        employmentType: attrText(empType?.name),
        dates: dateRange(p.dateRange) ?? dateRange(group.dateRange),
        // Not every position carries one -- sampling a single Position record to decide
        // which fields exist is how this got missed the first time.
        location: attrText(p.locationName) ?? attrText(p.geoLocationName),
        description: attrText(p.description),
        companyUrl: company?.url ?? null,
      });
    }
  }
  return out;
}

function educations(byUrn, profile) {
  return collection(byUrn, profile['*profileEducations']).map(e => {
    const school = byUrn.get(canonicalUrn(e['*school']));
    return {
    school: attrText(e.schoolName) ?? attrText(school?.name),
    schoolLinkedinUrl: school?.url ?? null,
    schoolSlug: slugFromUrl(school?.url),
    degree: attrText(e.degreeName),
    fieldOfStudy: attrText(e.fieldOfStudy),
    grade: attrText(e.grade),
    activities: attrText(e.activities),
    dates: dateRange(e.dateRange),
    description: attrText(e.description),
  };
  });
}

// The long-tail sections all hang off the Profile as collection refs and share a shape
// close enough to map generically; each entry names the fields worth lifting.
// `occupation.*profileEducation` ties a course/organization back to the education entry it
// belongs to, which is where its institution name lives.
const institutionOf = (byUrn, r) => {
  const edu = byUrn.get(canonicalUrn(r.occupation?.['*profileEducation']));
  return attrText(edu?.schoolName) ?? null;
};

const SIMPLE = {
  skills:        ['*profileSkills',               r => ({ name: attrText(r.name) })],
  certifications:['*profileCertifications',       r => ({ name: attrText(r.name), authority: attrText(r.authority), url: r.url ?? null, dates: dateRange(r.dateRange) })],
  languages:     ['*profileLanguages',            r => ({ name: attrText(r.name), proficiency: r.proficiency ?? null })],
  courses:       ['*profileCourses',              (r, byUrn) => ({ name: attrText(r.name), number: attrText(r.number), institution: institutionOf(byUrn, r) })],
  projects:      ['*profileProjects',             r => ({ name: attrText(r.title) ?? attrText(r.name), description: attrText(r.description), dates: dateRange(r.dateRange) })],
  honors:        ['*profileHonors',               r => ({ title: attrText(r.title), issuer: attrText(r.issuer), description: attrText(r.description) })],
  publications:  ['*profilePublications',         r => ({ name: attrText(r.name), publisher: attrText(r.publisher), description: attrText(r.description) })],
  patents:       ['*profilePatents',              r => ({ title: attrText(r.title), number: attrText(r.number) })],
  // The field is `positionHeld`, not `position` -- verified against a real record.
  organizations: ['*profileOrganizations',        (r, byUrn) => ({ name: attrText(r.name), positionHeld: attrText(r.positionHeld), dates: dateRange(r.dateRange), institution: institutionOf(byUrn, r), description: attrText(r.description) })],
  volunteering:  ['*profileVolunteerExperiences', r => ({ role: attrText(r.role), organization: attrText(r.companyName), cause: r.cause ?? null, description: attrText(r.description), dates: dateRange(r.dateRange) })],
  testScores:    ['*profileTestScores',           r => ({ name: attrText(r.name), score: attrText(r.score), description: attrText(r.description) })],
};

// A vectorImage is a rootUrl plus per-size artifacts; take the widest rendition.
// Two independent variations here, both seen live:
//   * the WRAPPER key differs by decoration -- `displayImageReference` on the memberIdentity
//     finder, `displayImage` on the by-urn read;
//   * the CONTENT is either a `vectorImage` (an upload: rootUrl + per-size artifacts) or a
//     plain `{url}` (a LinkedIn default, e.g. the stock cover texture).
// Handling only vectorImage silently returns null for anyone using a default image.
const vectorUrl = (pic) => {
  const ref = pic?.displayImageReference ?? pic?.displayImage ?? pic;
  const v = ref?.vectorImage ?? (ref?.rootUrl ? ref : null);
  if (v?.rootUrl && v.artifacts?.length) {
    return v.rootUrl + v.artifacts.reduce((a, b) => (b.width > a.width ? b : a)).fileIdentifyingUrlPathSegment;
  }
  return typeof ref?.url === 'string' ? ref.url : null;
};

// LinkedIn renders OUT_OF_NETWORK as "3rd+". Only OUT_OF_NETWORK has actually been observed;
// the DISTANCE_* spellings follow the enum and are unverified.
const DEGREE = {
  SELF: 'SELF', DISTANCE_1: '1st', DISTANCE_2: '2nd', DISTANCE_3: '3rd', OUT_OF_NETWORK: '3rd+',
};

export function parseProfile(json) {
  const subjectUrn = json?.data?.['*elements']?.[0];
  if (!subjectUrn) throw new Error('no data.*elements[0] -- not a memberIdentity response');
  const byUrn = indexIncluded(json.included);
  const p = byUrn.get(canonicalUrn(subjectUrn));
  if (!p) throw new Error('subject URN missing from included[] -- failed decoration');

  // Connection degree is a property of the RELATIONSHIP between the viewing session and this
  // member, not of the member -- so it legitimately differs per caller. It rides in the same
  // response under `urn:li:fsd_memberRelationship:<profileId>`; no extra request is needed.
  // Found because the drift telemetry flagged MemberRelationship as an unknown $type.
  // Observed on 2 of 5 test profiles; absent entirely for the rest, hence the null.
  const rel = byUrn.get(`urn:li:fsd_memberRelationship:${canonicalUrn(subjectUrn).split(':').pop()}`);
  const relUnion = rel?.memberRelationshipUnion ?? {};
  const relBranch = Object.keys(relUnion)[0] ?? null;
  const memberDistance = relBranch ? (relUnion[relBranch]?.memberDistance ?? null) : null;

  const photoFilterType = p.profilePicture?.photoFilterType
    ?? p.profilePicture?.photoFilterEditInfo?.photoFilterType ?? null;

  const geo = byUrn.get(canonicalUrn(p.geoLocation?.['*geo'] ?? p.geoLocation?.geoUrn));
  const industry = byUrn.get(canonicalUrn(p['*industry']));

  const profile = {
    publicIdentifier: p.publicIdentifier ?? null,
    profileId: canonicalUrn(subjectUrn).split(':').pop(),
    url: p.publicIdentifier ? `https://www.linkedin.com/in/${p.publicIdentifier}/` : null,
    name: [p.firstName, p.lastName].map(attrText).filter(Boolean).join(' ') || null,
    firstName: attrText(p.firstName),
    lastName: attrText(p.lastName),
    headline: attrText(p.headline),
    about: attrText(p.summary),
    location: attrText(geo?.defaultLocalizedName),
    countryCode: p.location?.countryCode ?? null,
    industry: attrText(industry?.name),
    premium: p.premium ?? null,
    memberDistance,                       // raw enum, e.g. OUT_OF_NETWORK / DISTANCE_1
    connectionDegree: DEGREE[memberDistance] ?? null,
    // The #OpenToWork and #Hiring banners are photo FRAMES, so they surface as a filter type on
    // the profile picture rather than as profile flags. `ORIGINAL` means no frame. The frame
    // spellings are inferred from the enum and UNVERIFIED -- no tested profile has one -- so the
    // raw value is exposed alongside the booleans rather than hidden behind them.
    photoFilterType,
    // REMOVED 2026-08-31. #OpenToWork / #Hiring are NOT in this decoration. They were derived
    // from `photoFilterType` (the photo EDITING filter: ORIGINAL / STUDIO / None), which cannot
    // encode a frame -- so every profile got a confident `false`, including two verified to be
    // carrying the frames. Searching every saved payload for jobSeeker / memberBadges / badges /
    // openToWork / photoFrame / frameType returns ZERO hits, while `showPremiumSubscriberBadge`
    // and `shouldShowSourceOfHireBadge` ARE present -- so LinkedIn does ship badge booleans here
    // and there is no open-to-work one. Dropped rather than emitted as a permanent null.
    profilePicture: vectorUrl(p.profilePicture),
    // The image's own asset URN, alongside the rendered URL. Rendered URLs carry an expiry
    // (`e=<epoch>`) and go stale; the URN is stable, so both are worth returning.
    profilePictureUrn: p.profilePicture?.displayImageUrn ?? null,
    coverImage: vectorUrl(p.backgroundPicture),
    coverImageUrn: p.backgroundPicture?.displayImageUrn ?? null,
    experience: positions(byUrn, p),
    education: educations(byUrn, p),
  };
  for (const [key, [ref, map]] of Object.entries(SIMPLE)) {
    profile[key] = collection(byUrn, p[ref]).map(r => map(r, byUrn));
  }

  // Drift telemetry: a $type we have never seen must arrive as a counted unknown rather
  // than as silence. Filtering by an accept-list is what makes losses invisible.
  const KNOWN = /(\.Profile|Position|PositionGroup|Education|School|Company|Skill|Certification|Geo|Industry|CollectionResponse|EmploymentType|TreasuryMedia|Language|Course|Project|Honor|Publication|Patent|Organization|VolunteerExperience|TestScore)$/;
  const unknownTypes = {};
  for (const rec of json.included ?? []) {
    const t = rec?.$type;
    if (t && !KNOWN.test(t)) unknownTypes[t] = (unknownTypes[t] ?? 0) + 1;
  }

  // Completeness per collection, so a caller can tell "none" from "we only got the first page".
  // featuredMedia is NOT an output field, but it IS tracked here: it is the only collection
  // that ever reports `unresolved` on real data (pearl 10/0, anna 8/2). Omitting it left the
  // unresolved detector documented, implemented, and never once exercised by a fixture.
  const REFS = { experience: '*profilePositionGroups', education: '*profileEducations',
    ...Object.fromEntries(Object.entries(SIMPLE).map(([k, [ref]]) => [k, ref])),
    featuredMedia: '*profileTreasuryMediaProfile' };
  const truncated = [], unresolved = [];
  const collections = {};
  for (const [key, ref] of Object.entries(REFS)) {
    const pg = pagingOf(byUrn, p[ref]);
    if (!pg) continue;
    // Experience paging counts position GROUPS (one per company) while profile.experience is
    // the flattened list of POSITIONS, so the two numbers legitimately differ -- 7 groups can
    // yield 10 roles. Name the unit or the mismatch reads as a bug.
    collections[key] = { ...pg, unit: key === 'experience' ? 'positionGroups' : 'items' };
    if (pg.truncated) truncated.push(`${key} (${pg.returned}/${pg.total})`);
    if (pg.unresolved) unresolved.push(`${key} (${pg.returned}/${pg.total})`);
  }

  return {
    profile,
    meta: {
      state: (truncated.length || unresolved.length) ? 'partial' : 'complete',
      includedCount: (json.included ?? []).length,
      collections,
      truncated,
      unresolved,
      unknownTypes: Object.entries(unknownTypes).map(([type, count]) => ({ type, count })),
    },
  };
}
