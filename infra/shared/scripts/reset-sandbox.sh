#!/usr/bin/env bash
# reset-sandbox.sh — Runs on the HOST as ubuntu user.
# Destroys existing sandbox, recreates providers and sandbox, restarts Copilot.
# Used when the EC2 instance already exists and only the sandbox needs refreshing.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

echo "=== Sandbox Reset started at $(date -u) ==="

# ── Kill existing bridge service SSH session ─────────────────────────────────
echo ">>> Stopping existing bridge service..."
BRIDGE_PID=$(cat ~/.bridge-pid 2>/dev/null || true)
if [ -n "$BRIDGE_PID" ] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
  kill "$BRIDGE_PID" 2>/dev/null || true
  sleep 2
  echo "  Bridge SSH session stopped (PID: $BRIDGE_PID)"
else
  echo "  No running bridge service found"
fi

# ── Destroy existing sandbox ─────────────────────────────────────────────────
echo ">>> Destroying existing sandbox..."
SANDBOX_NAME=$(cat ~/.sandbox-name 2>/dev/null || true)
if [ -n "$SANDBOX_NAME" ]; then
  openshell sandbox destroy "$SANDBOX_NAME" --force 2>&1 || true
  echo "  Sandbox $SANDBOX_NAME destroyed"
else
  echo "  No sandbox name found, destroying all..."
  for name in $(openshell sandbox list 2>/dev/null | tail -n +2 | awk '{print $1}'); do
    openshell sandbox destroy "$name" --force 2>&1 || true
    echo "  Destroyed $name"
  done
fi
rm -f ~/.sandbox-name

# ── Delete existing providers ────────────────────────────────────────────────
echo ">>> Deleting existing providers..."
for PROV_NAME in copilot github exa perplexity youtube zernio; do
  openshell provider delete "$PROV_NAME" 2>&1 || true
done
echo "  Providers deleted"

# ── Pull latest code ─────────────────────────────────────────────────────────
echo ">>> Pulling latest code..."
GIT_REF=$(cat ~/git-ref 2>/dev/null || echo "main")
cd ~/copilot-telegram-bridge 2>/dev/null && git fetch origin && git checkout "$GIT_REF" 2>&1 || echo "  No local repo to update"
cd ~

# ── Write credential files for provider recreation ───────────────────────────
# Original files were deleted after first provider creation. Recreate them
# from environment variables passed via SSH.
echo ">>> Writing credential files..."
[ -n "${COPILOT_GITHUB_TOKEN:-}" ] && echo "$COPILOT_GITHUB_TOKEN" > ~/copilot-token
[ -n "${GH_TOKEN:-}" ] && echo "$GH_TOKEN" > ~/github-token
[ -n "${EXA_API_KEY:-}" ] && echo "$EXA_API_KEY" > ~/exa-key
[ -n "${PERPLEXITY_API_KEY:-}" ] && echo "$PERPLEXITY_API_KEY" > ~/perplexity-key
[ -n "${YOUTUBE_API_KEY:-}" ] && echo "$YOUTUBE_API_KEY" > ~/youtube-key
[ -n "${ZERNIO_API_KEY:-}" ] && echo "$ZERNIO_API_KEY" > ~/zernio-key
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && echo "TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN" > ~/raw-secrets.env
chmod 600 ~/copilot-token ~/github-token ~/exa-key ~/perplexity-key ~/youtube-key ~/zernio-key ~/raw-secrets.env 2>/dev/null || true
echo "  Credential files written"

# ── Fix line endings on scripts ──────────────────────────────────────────────
for f in ~/setup-sandbox.sh ~/sandbox-setup.sh ~/sandbox-policy.yaml; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

# ── Run sandbox setup (creates providers + sandbox + starts copilot) ─────────
echo ">>> Running sandbox setup..."
bash ~/setup-sandbox.sh

echo "=== Sandbox Reset completed at $(date -u) ==="
