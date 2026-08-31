// Egress relay. Runs on a Tailscale node (your machine); a Cloudflare Worker calls it so the
// OUTBOUND request originates from this machine's residential IP instead of Cloudflare's
// datacenter range.
//
//   RELAY_SECRET=$(openssl rand -hex 32) node relay/server.mjs
//   tailscale funnel 8787            # publish it at https://<host>.<tailnet>.ts.net
//
// Exposed publicly by Funnel, so it is NOT an open proxy:
//   * every request must carry the shared secret
//   * only allowlisted hosts may be fetched
import { createServer } from 'node:http';

const PORT   = Number(process.env.RELAY_PORT || 8787);
const SECRET = process.env.RELAY_SECRET;
if (!SECRET) { console.error('refusing to start: set RELAY_SECRET'); process.exit(1); }

// An open proxy on a public URL would be abused within hours. Allowlist, not blocklist.
const ALLOWED_HOSTS = (process.env.RELAY_ALLOW_HOSTS || 'api.ipify.org,ifconfig.me,httpbin.org')
  .split(',').map(s => s.trim()).filter(Boolean);

const json = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
};

createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  if (u.pathname === '/health') return json(res, 200, { ok: true, allowed: ALLOWED_HOSTS });

  if (u.pathname !== '/fetch') return json(res, 404, { error: 'use /fetch?url=…' });

  // Constant-ish comparison is overkill here, but never log or echo the secret.
  if (req.headers['x-relay-secret'] !== SECRET) return json(res, 401, { error: 'bad or missing x-relay-secret' });

  const target = u.searchParams.get('url');
  if (!target) return json(res, 400, { error: 'missing ?url=' });

  let parsed;
  try { parsed = new URL(target); } catch { return json(res, 400, { error: 'unparsable url' }); }
  if (parsed.protocol !== 'https:') return json(res, 400, { error: 'https only' });
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return json(res, 403, { error: `host not allowlisted: ${parsed.hostname}`, allowed: ALLOWED_HOSTS });
  }

  // Forward only headers the caller explicitly asked us to, via x-fwd-* prefixes.
  const fwd = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith('x-fwd-')) fwd[k.slice(6)] = v;
  }

  const t0 = Date.now();
  try {
    const r = await fetch(target, { headers: fwd, redirect: 'manual' });
    const body = await r.text();
    json(res, 200, {
      relayed: true, status: r.status, ms: Date.now() - t0,
      location: r.headers.get('location'),
      contentType: r.headers.get('content-type'),
      body: body.slice(0, 100_000),
    });
  } catch (e) {
    json(res, 502, { relayed: true, error: String(e).slice(0, 200), ms: Date.now() - t0 });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`relay on :${PORT}  allowlist: ${ALLOWED_HOSTS.join(', ')}`);
  console.log(`publish with:  tailscale funnel ${PORT}`);
});
