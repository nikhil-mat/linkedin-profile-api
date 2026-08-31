// Import a browser session from a DevTools "Copy as cURL" capture.
//
//   node tools/session-import.mjs ~/li.curl     from a file
//   pbpaste | node tools/session-import.mjs -    from stdin  (macOS)
//   xclip -o | node tools/session-import.mjs -   from stdin  (Linux)
//   powershell Get-Clipboard | node tools/session-import.mjs -          (Windows)
//
// Writes .env and api/.dev.vars (0600, both gitignored) and NEVER prints a secret value --
// only shapes. Run it instead of pasting credentials anywhere: a value that reaches a chat log
// or a terminal transcript has to be rotated, one that goes file -> file does not.
//
// Copy a VOYAGER XHR, not the page load: only that request carries the full coherent bundle
// (jar + UA + sec-ch-ua + x-li-track) that src/session.mjs consumes.
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

// Accept a path OR stdin. The clipboard command differs per OS (pbpaste / xclip / xsel /
// wl-paste / Get-Clipboard), so the tool reads a stream instead of assuming any of them.
const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/session-import.mjs <curl-file>');
  console.error('       <clipboard command> | node tools/session-import.mjs -');
  process.exit(1);
}
const cur = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8');
const g = (re) => (cur.match(re)?.[1] ?? '');

const jar = g(/-b '([^']+)'/) || g(/-H 'cookie: ([^']+)'/);
if (!jar) { console.error('no cookie jar found -- is this a "Copy as cURL" capture?'); process.exit(1); }
if (!/\bli_at=/.test(jar)) { console.error('jar has no li_at -- not a logged-in request'); process.exit(1); }

// __cf_bm is Cloudflare Bot Management, issued at the moment the browser passed a bot check and
// valid for ~30 min. Its embedded timestamp is the truest "when was this minted", so the
// staleness guard is anchored to it rather than to when this script happened to run.
const cfIssued = Number(g(/__cf_bm=[^;]*?-(\d{10})\./)) || null;
const capturedAt = cfIssued ? new Date(cfIssued * 1000).toISOString() : new Date().toISOString();

const vals = {
  LINKEDIN_LI_AT:            jar.match(/\bli_at=([^;]+)/)[1],
  LINKEDIN_JSESSIONID:       jar.match(/\bJSESSIONID=("?[^;]+?"?)(?:;|$)/)[1],
  LINKEDIN_USER_AGENT:       g(/-H 'user-agent: ([^']+)'/),
  LINKEDIN_COOKIES:          jar,
  LINKEDIN_SEC_CH_UA:        g(/-H 'sec-ch-ua: ([^']+)'/),
  LINKEDIN_ACCEPT_LANGUAGE:  g(/-H 'accept-language: ([^']+)'/),
  LINKEDIN_X_LI_TRACK:       g(/-H 'x-li-track: (\{[^']+\})'/),
  LINKEDIN_SESSION_CAPTURED_AT: capturedAt,
};
const gpc = g(/-H 'sec-gpc: ([^']+)'/);
if (gpc) vals.LINKEDIN_EXTRA_HEADERS = JSON.stringify({ 'sec-gpc': gpc });

// Every value is single-quoted, for two independent reasons:
//   1. These files get `. ./.env`-sourced by shell scripts. An unquoted UA
//      (`Mozilla/5.0 (Windows NT 10.0; ...)`) is a syntax error on the parens, and
//      accept-language (`en-US,en;q=0.7`) breaks on the semicolon. Sourcing then FAILS PART WAY,
//      leaving some vars set and others empty -- silent, and worse than failing outright.
//   2. Single quotes are literal in POSIX sh, so nothing inside is expanded, and the inner
//      double quotes in sec-ch-ua / the cookie jar / the JSON blobs survive intact.
// A literal single quote is closed, escaped and reopened ('\'' ), which is also what
// dotenv-style readers expect to see.
const enc = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;

// REFUSE to clobber a real session. On 2026-08-31 this tool was run with a throwaway curl
// string to smoke-test stdin parsing, and it overwrote a live bundle with li_at=FAKE -- which
// was unrecoverable, because these files are gitignored by design and have no backup. Writing
// credentials is the tool's whole job, so the guard belongs at the destination, not the input.
const looksReal = (path) => {
  if (!existsSync(path)) return false;
  const m = readFileSync(path, 'utf8').match(/^LINKEDIN_LI_AT=['"]?([^'"\n]*)/m);
  return !!m && m[1].length > 40;          // a real li_at is ~152 chars; 'FAKE' is not
};
const force = process.argv.includes('--force');
const guarded = ['.env', 'api/.dev.vars'].filter(looksReal);
if (guarded.length && !force) {
  console.error(`refusing to overwrite an existing session in: ${guarded.join(', ')}`);
  console.error('back it up first, then re-run with --force');
  process.exit(1);
}

for (const path of ['.env', 'api/.dev.vars']) {
  const keep = {};
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !(m[1] in vals)) keep[m[1]] = m[2];     // preserve unrelated keys as-is
    }
  }
  const out = { ...keep, ...Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, enc(v)])) };
  writeFileSync(path, Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  chmodSync(path, 0o600);
  console.log(`${path.padEnd(16)} ${Object.keys(out).length} keys, 0600`);
}

const ageMin = (Date.now() - Date.parse(capturedAt)) / 60000;
console.log(`
captured at   ${capturedAt}  (${ageMin.toFixed(0)} min ago${cfIssued ? ', from __cf_bm' : ', clock time -- no __cf_bm'})
cookies       ${jar.split(';').length} (${jar.length} bytes)
user-agent    ${vals.LINKEDIN_USER_AGENT.slice(0, 46)}...
sec-ch-ua     ${vals.LINKEDIN_SEC_CH_UA || '(absent)'}
x-li-track    ${vals.LINKEDIN_X_LI_TRACK ? 'present' : '(absent)'}
sec-gpc       ${gpc || '(absent)'}

No secret values printed. __cf_bm expires ~30 min after capture; re-run this before a live call.`);
