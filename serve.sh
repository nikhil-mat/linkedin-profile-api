#!/usr/bin/env bash
# Start the API and expose it on a public HTTPS URL you can hand to someone.
#
#   ./serve.sh
#
# Ctrl-C stops both. Anyone holding the URL can spend YOUR LinkedIn account, since the
# server answers with its own bound session and there is no caller auth -- share it
# privately and stop this when you are done.
set -euo pipefail
cd "$(dirname "$0")"

PORT=8811
LOG=$(mktemp -d)/tunnel.log

cleanup() {
  echo
  echo "stopping…"
  [[ -n "${TUNNEL_PID:-}" ]] && kill "$TUNNEL_PID" 2>/dev/null || true
  [[ -n "${WORKER_PID:-}" ]] && kill "$WORKER_PID" 2>/dev/null || true
  pkill -f "wrangler dev --port $PORT" 2>/dev/null || true
  pkill -f "workerd" 2>/dev/null || true
  echo "stopped."
}
trap cleanup EXIT INT TERM

# --- preflight -------------------------------------------------------------------
command -v cloudflared >/dev/null || { echo "cloudflared not found — brew install cloudflared"; exit 1; }

if ! grep -q "^LINKEDIN_LI_AT='.\{40,\}'" api/.dev.vars 2>/dev/null; then
  echo "No session in api/.dev.vars. Import one first:"
  echo "    pbpaste | node tools/session-import.mjs -"
  exit 1
fi

if grep -qE "^UPSTREAM_DISABLED='?(true|1|yes|on)'?" api/.dev.vars; then
  echo "UPSTREAM_DISABLED is armed — the API will answer 503 for every profile request."
  echo "Disarm it and re-run:"
  echo "    sed -i '' \"s/^UPSTREAM_DISABLED=.*/UPSTREAM_DISABLED='false'/\" api/.dev.vars"
  exit 1
fi

# --- worker ----------------------------------------------------------------------
echo "starting worker on :$PORT …"
( cd api && npx wrangler dev --port "$PORT" >/dev/null 2>&1 ) &
WORKER_PID=$!

for _ in $(seq 30); do
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null || { echo "worker failed to start"; exit 1; }
echo "  worker up"

# --- tunnel ----------------------------------------------------------------------
echo "opening tunnel …"
cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 30); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [[ -n "$URL" ]] && break
  sleep 1
done
[[ -n "$URL" ]] || { echo "tunnel did not produce a URL — see $LOG"; exit 1; }

cat <<TXT

  ┌─────────────────────────────────────────────────────────────
  │  $URL
  └─────────────────────────────────────────────────────────────

  share this:
    $URL/profile?url=https://www.linkedin.com/in/<slug>/

  also on it:
    $URL/ui        browsable console
    $URL/schema    every field the API returns
    $URL/budget    requests spent today, cap, cooldown

  every call spends your LinkedIn account. Ctrl-C to stop.

TXT

wait "$TUNNEL_PID"
