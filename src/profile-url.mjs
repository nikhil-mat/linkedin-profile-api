const LINKEDIN_HOSTS = new Set(['linkedin.com', 'www.linkedin.com']);

export function parseProfileUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError('Pass a full URL such as https://www.linkedin.com/in/satya-nadella/');
  }

  const path = url.pathname.split('/').filter(Boolean);
  if (
    url.protocol !== 'https:'
    || !LINKEDIN_HOSTS.has(url.hostname.toLowerCase())
    || url.username
    || url.password
    || url.port
    || path[0] !== 'in'
    || !path[1]
    || path.length !== 2
  ) {
    throw new TypeError('The argument must be an HTTPS linkedin.com/in/... profile URL.');
  }

  let publicIdentifier;
  try {
    publicIdentifier = decodeURIComponent(path[1]);
  } catch {
    throw new TypeError('The profile identifier contains invalid URL encoding.');
  }

  if (!/^[\p{L}\p{N}._~-]+$/u.test(publicIdentifier)) {
    throw new TypeError('The LinkedIn profile identifier contains unsupported characters.');
  }

  return {
    publicIdentifier,
    canonicalUrl: `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}/`,
  };
}
