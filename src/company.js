// Company detail — the ONLY source of the company's own website. The profile decoration carries
// `Company.url`, which is the LinkedIn PAGE (linkedin.com/company/<slug>), not the website.
// Those are different fields and wiring one for the other is an easy, silent mistake.
//
// Route: voyagerOrganizationDashCompanies, variables=(universalName:<slug>)
// The slug comes from the profile we already fetched (Company.universalName), so no lookup
// call is needed -- one request per company, and only for the company asked about.
//
// ⚠️ Shapes probed defensively: `websiteUrl` is documented by linkedin-mcp's types but has not
// been observed by us. A wrong guess must yield null, never a wrong value.
const walk = function* (node, depth = 0) {
  if (depth > 40 || node == null || typeof node !== 'object') return;
  yield node;
  for (const v of Object.values(node)) if (v && typeof v === 'object') yield* walk(v, depth + 1);
};

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// A LinkedIn page URL is NOT a website. Reject those explicitly so the two never conflate.
const isLinkedIn = (u) => typeof u === 'string' && /linkedin\.com/i.test(u);

export function parseCompany(json, wantSlug) {
  const nodes = [...walk(json?.data ?? json), ...walk(json?.included ?? [])];

  // The company is described by SEVERAL records, not one: a Company (name, description,
  // employeeCountRange) and an OrganizationalPage-shaped record (websiteUrl, foundedOn,
  // pageType). Picking a single node that had both `universalName` AND `name` silently skipped
  // the record carrying websiteUrl -- it has universalName but no name. Merge every node that
  // matches the requested slug.
  const matching = nodes.filter(n => typeof n?.universalName === 'string'
    && (!wantSlug || n.universalName === wantSlug));
  const pool = matching.length ? matching
    : nodes.filter(n => typeof n?.universalName === 'string' && typeof n?.name === 'string');
  if (!pool.length) {
    return { websiteUrl: null, name: null, description: null, staffCount: null,
             followerCount: null, linkedinUrl: null, universalName: null, matched: false };
  }
  const pick = (key, test = () => true) => {
    for (const n of pool) if (n[key] != null && test(n[key])) return n[key];
    return null;
  };

  // A bare domain ("ontross.com") is what LinkedIn stores -- normalise to a URL, but never
  // accept a linkedin.com value, which would be the page rather than the website.
  const rawSite = pick('websiteUrl') ?? pick('website');
  const websiteUrl = typeof rawSite === 'string' && rawSite.trim() && !/linkedin\.com/i.test(rawSite)
    ? (/^https?:\/\//i.test(rawSite) ? rawSite.trim() : `https://${rawSite.trim()}`)
    : null;

  const ecr = pick('employeeCountRange');
  return {
    websiteUrl,
    linkedinUrl: str(pick('url', isLinkedIn)),
    name: str(pick('name')),
    universalName: str(pick('universalName')),
    description: str(pick('description')),
    staffCount: typeof pick('staffCount') === 'number' ? pick('staffCount')
              : (ecr ? `${ecr.start ?? '?'}-${ecr.end ?? '+'}` : null),
    headquarter: pick('headquarter')?.city ?? pick('headquarter')?.country ?? null,
    foundedOn: pick('foundedOn')?.year ?? null,
    followerCount: null,
    matched: wantSlug ? pool.some(n => n.universalName === wantSlug) : null,
  };
}
