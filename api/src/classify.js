// Classify BEFORE parsing. A 302/410/999 handed to a parser yields a plausible-looking empty
// profile, which is indistinguishable from a real one -- the failure this design exists to stop.
//
// Hard-won: a 302 whose Location is the SAME url is NOT a datacenter block and NOT an account
// restriction. It means the session/CSRF is no longer valid. Observed 2026-08-30: a session
// worked locally, was used once from a Cloudflare IP, and was invalidated everywhere -- the
// remedy is re-extract cookies, never retry.
export const OUTCOMES = {
  OK:              { http: 200 },
  SESSION_INVALID: { http: 401, retryable: false, hint: 're-extract li_at + JSESSIONID from the browser; they must come from the same session. Presenting a session from a datacenter IP can invalidate it.' },
  CSRF_REJECTED:   { http: 401, retryable: false, hint: 'csrf-token must equal JSESSIONID with quotes stripped (ajax: prefix kept)' },
  FORBIDDEN:       { http: 403, retryable: false, hint: 'this specific profile may be restricted; 5+ consecutive means a session problem' },
  NOT_FOUND:       { http: 404, retryable: false, hint: 'no such public identifier' },
  RATE_LIMITED:    { http: 429, retryable: false, hint: 'upstream throttled — do NOT retry; a cooldown is now in force' },
  REQUEST_DENIED:  { http: 429, retryable: false, hint: 'HTTP 999 network-layer block; stop generating traffic for hours' },
  SCHEMA_DRIFT:    { http: 502, retryable: false, hint: 'decoration id likely rotated; re-capture it' },
  GONE:            { http: 502, retryable: false, hint: 'endpoint retired' },
  UPSTREAM_ERROR:  { http: 502, retryable: false },
};

export function classify(status, location, url) {
  if (status === 200) return 'OK';
  if (status >= 300 && status < 400) {
    if (/\/uas\/login|\/checkpoint|\/login/.test(location || '')) return 'SESSION_INVALID';
    // Self-redirect: same URL back. Session/CSRF no longer accepted.
    if (location && url && location.split('?')[0] === url.split('?')[0]) return 'SESSION_INVALID';
    return 'SESSION_INVALID';
  }
  if (status === 401) return 'SESSION_INVALID';
  if (status === 403) return 'CSRF_REJECTED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 410) return 'GONE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 999) return 'REQUEST_DENIED';
  if (status === 400) return 'SCHEMA_DRIFT';
  return 'UPSTREAM_ERROR';
}
