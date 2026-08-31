// Compares two egress paths for the SAME target, N times each:
//   direct : Worker -> target            (Cloudflare datacenter IP)
//   relayed: Worker -> Tailscale node -> target  (residential IP)
//
// The target echoes the caller's IP, so the two paths are distinguishable. No LinkedIn traffic.
const TARGET = 'https://api.ipify.org?format=json';
const N = 5;

const pct = (arr, p) => arr.length ? [...arr].sort((a, b) => a - b)[Math.floor((arr.length - 1) * p)] : null;
const summarise = (runs) => {
  const ok = runs.filter(r => r.ok);
  const ms = ok.map(r => r.ms);
  return {
    attempts: runs.length, ok: ok.length,
    successRate: `${Math.round(100 * ok.length / runs.length)}%`,
    ms: { min: ms.length ? Math.min(...ms) : null, p50: pct(ms, 0.5),
          p95: pct(ms, 0.95), max: ms.length ? Math.max(...ms) : null },
    ip: ok.map(r => r.ip).find(Boolean) ?? null,
    errors: [...new Set(runs.filter(r => !r.ok).map(r => r.error))].slice(0, 3),
  };
};

async function direct() {
  const t0 = Date.now();
  try {
    const r = await fetch(TARGET, { headers: { 'user-agent': 'egress-test' } });
    const b = await r.text();
    return { ok: r.ok, ms: Date.now() - t0, ip: JSON.parse(b).ip };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e).slice(0, 120) }; }
}

async function relayed(env) {
  const t0 = Date.now();
  try {
    const url = `${env.RELAY_URL.replace(/\/$/, '')}/fetch?url=${encodeURIComponent(TARGET)}`;
    const r = await fetch(url, { headers: {
      'x-relay-secret': env.RELAY_SECRET ?? '',
      'x-fwd-user-agent': 'egress-test',
    }});
    const j = await r.json();
    if (!r.ok || j.error) return { ok: false, ms: Date.now() - t0, error: (j.error ?? `HTTP ${r.status}`).slice(0, 120) };
    return { ok: true, ms: Date.now() - t0, ip: JSON.parse(j.body).ip, upstreamMs: j.ms };
  } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e).slice(0, 120) }; }
}

export default {
  async fetch(_req, env) {
    if (!env.RELAY_URL) {
      return Response.json({ error: 'RELAY_URL not set — put your Tailscale Funnel URL in wrangler.toml [vars]' }, { status: 400 });
    }
    const d = [], r = [];
    for (let i = 0; i < N; i++) { d.push(await direct()); r.push(await relayed(env)); }

    const D = summarise(d), R = summarise(r);
    return Response.json({
      question: 'Can a Cloudflare Worker route egress through a Tailscale node, and how well?',
      target: TARGET,
      direct: D,
      relayed: R,
      differentEgressIP: !!(D.ip && R.ip && D.ip !== R.ip),
      overheadMs: (D.ms.p50 != null && R.ms.p50 != null) ? R.ms.p50 - D.ms.p50 : null,
      verdict: !R.ok ? 'relay unreachable — check Funnel is up and RELAY_SECRET matches'
             : (D.ip && R.ip && D.ip !== R.ip)
               ? `WORKS — relayed traffic egresses from ${R.ip} instead of ${D.ip}`
               : 'relay responded but the egress IP did not change',
    });
  },
};
