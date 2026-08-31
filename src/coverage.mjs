const PROFILE_TYPE = 'com.linkedin.voyager.dash.identity.profile.Profile';

function typeCounts(included) {
  const counts = new Map();
  for (const entity of included) {
    const type = entity?.$type ?? '(no $type)';
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function matchingTypes(included, words) {
  const matches = {};
  for (const entity of included) {
    const type = entity?.$type ?? '';
    if (words.some((word) => type.toLowerCase().includes(word.toLowerCase()))) {
      matches[type] = (matches[type] ?? 0) + 1;
    }
  }
  return matches;
}

function referenceStatus(profile, includedByUrn, candidates) {
  const key = candidates.find((candidate) => profile[candidate] !== undefined);
  if (!key) return { status: 'not referenced by target profile' };

  const value = profile[key];
  const references = Array.isArray(value) ? value : [value];
  const resolved = references.filter(
    (reference) => typeof reference === 'object' || includedByUrn.has(reference),
  ).length;

  return {
    status: resolved ? 'referenced and resolved in included[]' : 'referenced but unresolved',
    profileField: key,
    references: references.length,
    resolved,
  };
}

function inlineStatus(profile, candidates) {
  const key = candidates.find((candidate) => profile[candidate] != null);
  return key
    ? { status: 'present on target profile', profileField: key }
    : { status: 'not present on target profile' };
}

function isReferenceKey(key) {
  return key.startsWith('*')
    || (key !== 'entityUrn' && (key.endsWith('Urn') || key.endsWith('Urns')))
    || key.includes('ResolutionResult');
}

function urnReferences(value, path = '', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isReferenceKey(key)) {
      const values = Array.isArray(child) ? child : [child];
      for (const reference of values) {
        if (typeof reference === 'string' && reference.startsWith('urn:li:')) {
          found.push({ field: childPath, urn: reference });
        }
      }
    }
    if (child && typeof child === 'object') urnReferences(child, childPath, found);
  }
  return found;
}

export function walkReachableGraph(profile, includedByUrn) {
  const rootProfileUrn = profile.entityUrn;
  const queue = [{ entity: profile, reachedVia: 'data.*elements[0]' }];
  const visited = new Set();
  const entities = [];
  const unresolvedReferences = [];
  const externalProfileReferences = [];

  while (queue.length) {
    const { entity, reachedVia } = queue.shift();
    const urn = entity?.entityUrn;
    if (!urn || visited.has(urn)) continue;
    visited.add(urn);

    const references = urnReferences(entity).map((reference) => {
      const resolved = includedByUrn.has(reference.urn);
      if (!resolved) {
        unresolvedReferences.push({ fromUrn: urn, field: reference.field, urn: reference.urn });
      } else if (
        includedByUrn.get(reference.urn)?.$type === PROFILE_TYPE
        && reference.urn !== rootProfileUrn
      ) {
        externalProfileReferences.push({
          fromUrn: urn,
          field: reference.field,
          urn: reference.urn,
        });
      } else if (!visited.has(reference.urn)) {
        queue.push({
          entity: includedByUrn.get(reference.urn),
          reachedVia: `${urn}.${reference.field}`,
        });
      }
      return { ...reference, resolved };
    });

    entities.push({
      urn,
      type: entity.$type ?? null,
      reachedVia,
      keys: Object.keys(entity).sort(),
      references,
    });
  }

  const schemas = {};
  for (const entity of entities) {
    const type = entity.type ?? '(no $type)';
    const schema = schemas[type] ?? { entityCount: 0, observedKeys: [] };
    schema.entityCount += 1;
    schema.observedKeys = [...new Set([...schema.observedKeys, ...entity.keys])].sort();
    schemas[type] = schema;
  }

  return { entities, schemas, unresolvedReferences, externalProfileReferences };
}

function targetUrnFrom(raw) {
  const outer = raw?.data ?? {};
  const data = outer?.data && typeof outer.data === 'object' ? outer.data : outer;
  return data?.['*elements']?.[0]
    ?? data?.identityDashProfilesByMemberIdentity?.['*elements']?.[0]
    ?? null;
}

export function buildCoverage(
  raw,
  { decorationId = null, contract = null, expectedPublicIdentifier = null } = {},
) {
  const included = Array.isArray(raw?.included) ? raw.included : [];
  const includedByUrn = new Map();
  const duplicateUrns = new Set();
  for (const entity of included) {
    if (!entity?.entityUrn) continue;
    if (includedByUrn.has(entity.entityUrn)) duplicateUrns.add(entity.entityUrn);
    else includedByUrn.set(entity.entityUrn, entity);
  }
  const targetUrn = targetUrnFrom(raw);

  if (duplicateUrns.size) {
    return {
      decorationId,
      contract,
      targetUrn,
      targetResolved: false,
      warning: 'The response contains duplicate entityUrn values and is ambiguous.',
      duplicateUrns: [...duplicateUrns].sort(),
      includedEntityCount: included.length,
      includedTypes: typeCounts(included),
    };
  }

  const target = targetUrn ? includedByUrn.get(targetUrn) : null;
  const profile = target?.$type === PROFILE_TYPE ? target : null;

  if (!profile) {
    return {
      decorationId,
      contract,
      targetUrn,
      targetResolved: false,
      warning: 'The Profile identified by data.*elements[0] could not be resolved.',
      includedEntityCount: included.length,
      includedTypes: typeCounts(included),
    };
  }

  if (
    expectedPublicIdentifier
    && profile.publicIdentifier
    && profile.publicIdentifier.toLowerCase() !== expectedPublicIdentifier.toLowerCase()
  ) {
    return {
      decorationId,
      contract,
      targetUrn,
      targetResolved: false,
      warning: 'The returned Profile does not match the requested public identifier.',
      expectedPublicIdentifier,
      returnedPublicIdentifier: profile.publicIdentifier ?? null,
      includedEntityCount: included.length,
    };
  }

  const sections = {
    name: inlineStatus(profile, ['firstName', 'lastName']),
    headline: inlineStatus(profile, ['headline']),
    about: inlineStatus(profile, ['summary']),
    location: inlineStatus(profile, ['locationName', 'geoLocation', 'address']),
    profileImage: inlineStatus(profile, ['profilePicture', 'picture']),
    backgroundImage: inlineStatus(profile, ['backgroundPicture']),
    experience: referenceStatus(
      profile,
      includedByUrn,
      ['*profilePositionGroups', '*positionGroups'],
    ),
    education: referenceStatus(
      profile,
      includedByUrn,
      ['*profileEducations', '*educations'],
    ),
    skills: referenceStatus(profile, includedByUrn, ['*profileSkills', '*skills']),
    certifications: referenceStatus(
      profile,
      includedByUrn,
      ['*profileCertifications', '*certifications'],
    ),
    languages: referenceStatus(profile, includedByUrn, ['*profileLanguages', '*languages']),
  };

  const sectionWords = [
    'Position', 'Education', 'Skill', 'Certification', 'Language', 'Volunteer',
    'Project', 'Honor', 'Course', 'Publication', 'Organization', 'TestScore',
  ];
  const reachableGraph = walkReachableGraph(profile, includedByUrn);
  const microSchema = raw?.meta?.microSchema;
  const identityVerification = expectedPublicIdentifier
    ? (profile.publicIdentifier ? 'response-echo-matched' : 'request-bound-no-response-echo')
    : 'not-requested';

  return {
    decorationId,
    contract,
    targetUrn,
    targetResolved: true,
    publicIdentifier: profile.publicIdentifier ?? null,
    expectedPublicIdentifier,
    identityVerification,
    includedEntityCount: included.length,
    targetProfileFields: Object.keys(profile).sort(),
    targetProfileReferences: Object.keys(profile).filter((key) => key.startsWith('*')).sort(),
    sections,
    microSchema: {
      present: Boolean(microSchema),
      topLevelKeys: microSchema && typeof microSchema === 'object'
        ? Object.keys(microSchema).sort()
        : [],
      note: 'The complete microSchema remains available in the raw capture.',
    },
    targetReachableEntityCount: reachableGraph.entities.length,
    targetReachableSchemas: reachableGraph.schemas,
    targetReachableEntities: reachableGraph.entities,
    unresolvedTargetReferences: reachableGraph.unresolvedReferences,
    externalProfileReferences: reachableGraph.externalProfileReferences,
    sectionRelatedIncludedTypes: matchingTypes(included, sectionWords),
    includedTypes: typeCounts(included),
  };
}
