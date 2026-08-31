// Durable Object that serialises EVERY upstream call to LinkedIn.
//
// Why a DO and not KV: KV is eventually consistent (~60s). Two concurrent requests would both
// read the same stale `lastCall` and both fire immediately -- precisely the burst that gets an
// account restricted. A DO is single-threaded and strongly consistent, so "one call at a time,
// paced" is actually enforced rather than hoped for.
//
// This is deliberately a GLOBAL bottleneck: there is one LinkedIn session, so there should be
// one queue. Throughput is not the goal; not losing the account is.

// Caps carry their provenance so nobody later mistakes a guess for a measurement.
export const BUDGET = {
  minIntervalMs: 1000,   // measured (linkedin-toolkit §13: 1.0s + jitter sustained 1700+ reads)
  jitterMs:      1500,   // measured
  dailyCap:      200,    // guessed — deliberately conservative
  provenance: { minIntervalMs: 'measured', jitterMs: 'measured', dailyCap: 'guessed' },
};

// A 429 is the warning shot on a documented escalation ladder (warning -> 1-3 week restriction
// -> permanent). Retrying into it is the mechanism that converts a warning into a restriction,
// so these are cooldowns, never backoff-and-retry.
const COOLDOWN_MS = {
  RATE_LIMITED:   60 * 60 * 1000,       // 429 -> 1h
  REQUEST_DENIED:  6 * 60 * 60 * 1000,  // 999 -> 6h (network-layer bot block)
};

export class UpstreamLimiter {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const { action, outcome } = await request.json();
    const now = Date.now();
    const day = new Date().toISOString().slice(0, 10);

    if (action === 'status') return Response.json(await this.#status(now, day));

    if (action === 'record') {
      const ms = COOLDOWN_MS[outcome];
      if (ms) await this.state.storage.put('cooldown', { until: now + ms, cause: outcome });
      return Response.json({ ok: true });
    }

    // action === 'acquire'
    const cd = await this.state.storage.get('cooldown');
    if (cd && cd.until > now) {
      return Response.json({ ok: false, reason: 'COOLDOWN', cause: cd.cause,
                             secondsLeft: Math.ceil((cd.until - now) / 1000) });
    }

    const spent = (await this.state.storage.get(`spend:${day}`)) || 0;
    if (spent >= BUDGET.dailyCap) {
      return Response.json({ ok: false, reason: 'DAILY_CAP', spent, cap: BUDGET.dailyCap,
                             capProvenance: BUDGET.provenance.dailyCap });
    }

    // Pace. Reads are throttled as hard as writes: documented restrictions have followed fast
    // manual browsing alone, so pacing only writes would aim at the wrong threat.
    const last = (await this.state.storage.get('lastCall')) || 0;
    const need = BUDGET.minIntervalMs + Math.floor(Math.random() * BUDGET.jitterMs);
    const wait = Math.max(0, need - (now - last));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));

    const at = Date.now();
    await this.state.storage.put('lastCall', at);
    await this.state.storage.put(`spend:${day}`, spent + 1);
    return Response.json({ ok: true, waitedMs: wait, spent: spent + 1, cap: BUDGET.dailyCap });
  }

  async #status(now, day) {
    const cd = await this.state.storage.get('cooldown');
    return {
      spentToday: (await this.state.storage.get(`spend:${day}`)) || 0,
      dailyCap: BUDGET.dailyCap,
      minIntervalMs: BUDGET.minIntervalMs,
      provenance: BUDGET.provenance,
      cooldown: cd && cd.until > now
        ? { active: true, cause: cd.cause, secondsLeft: Math.ceil((cd.until - now) / 1000) }
        : { active: false },
    };
  }
}

// Single named instance: one session => one queue.
export const limiterFor = (env) => env.UPSTREAM_LIMITER.get(env.UPSTREAM_LIMITER.idFromName('linkedin-session'));
export const callLimiter = (env, body) =>
  limiterFor(env).fetch('https://limiter/', { method: 'POST', body: JSON.stringify(body) });
