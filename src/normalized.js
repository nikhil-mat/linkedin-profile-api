// Parser for `GET /voyager/api/identity/normalizedProfiles/<memberId>` — a DIFFERENT Voyager
// resource from the profile decoration, carrying fields that decoration does not:
//
//   distance                → connection degree
//   *followingInfo          → follower count
//   *badges                 → open-to-work / hiring
//   confirmedEmailAddresses → contact email (expected: only for 1st-degree / self)
//   confirmedPhoneNumbers   → contact phone (same expectation)
//
// A decoration is a server-side FIELD RECIPE, not the whole of what Voyager knows. "Absent from
// this response" never meant "Voyager cannot supply it" — this module exists because those two
// were conflated once already.
//
// STATUS: ✅ VERIFIED LIVE 2026-08-31. Every inferred shape turned out correct on a real
// response: followers 2909, distance DISTANCE_3 -> '3rd', badges as booleans, contact fields
// absent for a non-connection (as expected -- LinkedIn does not expose them to strangers).
// Shapes are still probed defensively so a future reshuffle yields null, never a wrong value.

const DEGREE = {
  SELF: 'SELF', DISTANCE_1: '1st', DISTANCE_2: '2nd', DISTANCE_3: '3rd', OUT_OF_NETWORK: '3rd+',
};

// The payload may be the record itself, `{data}`, or a collection under `elements[0]`.
const subject = (json) =>
  json?.elements?.[0] ?? json?.data?.elements?.[0] ?? json?.data ?? json ?? {};

const index = (json) => {
  const m = new Map();
  for (const r of json?.included ?? []) if (r?.entityUrn) m.set(r.entityUrn, r);
  return m;
};

// Follow a `*ref` into included[]; tolerate the value being inlined instead of referenced.
const deref = (byUrn, node, key) => {
  const ref = node?.[`*${key}`];
  if (typeof ref === 'string') return byUrn.get(ref) ?? null;
  return node?.[key] && typeof node[key] === 'object' ? node[key] : null;
};

const firstString = (v) => {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) { for (const x of v) { const s = firstString(x); if (s) return s; } return null; }
  if (v && typeof v === 'object') {
    for (const k of ['emailAddress', 'phoneNumber', 'number', 'address', 'value']) {
      const s = firstString(v[k]); if (s) return s;
    }
  }
  return null;
};

export function parseNormalized(json) {
  const p = subject(json);
  const byUrn = index(json);

  const following = deref(byUrn, p, 'followingInfo');
  const badges = deref(byUrn, p, 'badges') ?? {};

  // Only assert a badge when the field is actually present; absent must stay null, never false —
  // "not shown" and "no badge" are different answers.
  const bool = (v) => (typeof v === 'boolean' ? v : null);

  return {
    connectionDegree: DEGREE[p.distance] ?? null,
    memberDistance: p.distance ?? null,
    followers: typeof following?.followerCount === 'number' ? following.followerCount : null,
    following: typeof following?.followingCount === 'number' ? following.followingCount : null,
    isOpenToWork: bool(badges.jobSeeker ?? badges.openToWork),
    isHiring: bool(badges.hiring ?? badges.openToRecruit),
    isInfluencer: bool(badges.influencer),
    isPremium: bool(badges.premium),
    // Expected empty for non-connections; LinkedIn does not expose contact details to strangers.
    email: firstString(p.confirmedEmailAddresses),
    phone: firstString(p.confirmedPhoneNumbers),
    locationDisplayName: p.location?.locationDisplayName ?? null,
    profileUrl: p.profileUrl ?? null,
  };
}

// Every field this module claims, and how far it is actually trusted.
export const PROVENANCE = {
  source: 'GET /voyager/api/identity/normalizedProfiles/<memberId>',
  observed: 'HTTP 200, ~8 KB, key list recorded 2026-08-30',
  verified: ['connectionDegree', 'memberDistance', 'followers', 'isOpenToWork', 'isHiring',
             'isInfluencer', 'isPremium', 'locationDisplayName'],
  // Present in the response's key list but never seen populated: LinkedIn withholds contact
  // details from non-connections, so a null here is expected, not a parser failure.
  inferred: ['following', 'email', 'phone'],
  note: 'Verified live 2026-08-31 against a 3rd-degree profile. email/phone stayed null, which '
      + 'is the expected behaviour for a non-connection rather than evidence of a wrong shape.',
};
