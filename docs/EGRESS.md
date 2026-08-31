# 11 — Routing Worker egress through a Tailscale node

**Why:** a Cloudflare Worker egresses from a datacenter IP. Some upstreams treat those
differently from residential ones. This routes the outbound hop through a machine you control
without giving up hosting the API on Workers.

**Why not an exit node:** exit nodes route traffic for *Tailscale clients* at the WireGuard
layer. A Worker can never be a Tailscale client — the Workers runtime has no UDP
(`cloudflare:sockets` is TCP-only), so WireGuard cannot run there. Funnel instead publishes the
relay as a plain HTTPS URL, which a Worker *can* call.

```
Worker ──HTTPS──▶ https://<host>.<tailnet>.ts.net ──▶ relay (your machine) ──▶ target
                         Tailscale Funnel                 residential IP
```

---

## 1. Start Tailscale

The CLI is inside the app bundle on macOS and is not on `PATH`:

```bash
alias ts=/Applications/Tailscale.app/Contents/MacOS/Tailscale
ts status          # "Tailscale is stopped." until you launch + log in via the menu-bar app
```

## 2. One-time tailnet setup

Funnel needs two things enabled in the admin console (https://login.tailscale.com/admin):

1. **HTTPS certificates** — DNS page → enable MagicDNS + HTTPS.
2. **Funnel** — the node needs the `funnel` attribute in the ACL policy:

```jsonc
"nodeAttrs": [
  { "target": ["autogroup:member"], "attr": ["funnel"] }
]
```

`ts funnel 8787` prints the exact link to fix whichever piece is missing.

## 3. Run the relay

```bash
export RELAY_SECRET=$(openssl rand -hex 32)
echo "$RELAY_SECRET"                       # you need this for the Worker
RELAY_SECRET="$RELAY_SECRET" node relay/server.mjs
```

`relay/server.mjs` is deliberately **not** an open proxy — Funnel puts it on a public URL:

- every request must carry `x-relay-secret`
- only allowlisted hosts may be fetched (`RELAY_ALLOW_HOSTS`, default: ipify/ifconfig/httpbin)
- `https:` only
- forwards only headers the caller prefixes `x-fwd-` (so the client controls its own UA)

## 4. Publish it

```bash
ts funnel 8787
# → Available on the internet:
#   https://<host>.<tailnet>.ts.net
```

Funnel maps the public 443 to your local 8787. Verify from anywhere:

```bash
curl https://<host>.<tailnet>.ts.net/health
# {"ok":true,"allowed":[...]}
```

## 5. Point the Worker at it

`egress-worker/wrangler.toml`:
```toml
[vars]
RELAY_URL = "https://<host>.<tailnet>.ts.net"
```
```bash
cd egress-worker
npx wrangler secret put RELAY_SECRET      # paste the value from step 3
npx wrangler dev --remote                 # real edge egress, local code
```

The worker fetches the same IP-echo target twice — directly and through the relay — and reports
both egress IPs, success rate, p50/p95 latency and the relay overhead.

**Expected:** `direct.ip` = a Cloudflare address, `relayed.ip` = your residential address.
Different IPs ⇒ the hop works.

---

## Operational notes

- **Funnel URL is public.** The secret and the allowlist are the only things standing between it
  and an open proxy. Never widen `RELAY_ALLOW_HOSTS` to a wildcard.
- **Your machine becomes a dependency.** Laptop asleep ⇒ API down. For anything real, run the
  relay on an always-on box.
- **Latency doubles-ish.** Worker → Funnel → your ISP → target, then back. Measure it (the worker
  reports p50/p95) before assuming it is acceptable.
- **Alternative:** Cloudflare Tunnel (`cloudflared`) does the same job and keeps traffic inside
  Cloudflare's network to your origin. Same relay, different publishing mechanism.
- **Egress choice is one module.** The client's transport is isolated, so switching direct ⇄
  relay is a config change, not a rewrite.
