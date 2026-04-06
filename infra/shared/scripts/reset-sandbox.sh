#!/usr/bin/env bash
# reset-sandbox.sh — Runs on the HOST as ubuntu user.
# Destroys existing sandbox, recreates providers and sandbox, restarts Copilot.
# Used when the EC2 instance already exists and only the sandbox needs refreshing.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

echo "=== Sandbox Reset started at $(date -u) ==="

# ── Kill existing Copilot SSH session ────────────────────────────────────────
echo ">>> Stopping existing Copilot session..."
COPILOT_PID=$(cat ~/.copilot-pid 2>/dev/null || true)
if [ -n "$COPILOT_PID" ] && kill -0 "$COPILOT_PID" 2>/dev/null; then
  kill "$COPILOT_PID" 2>/dev/null || true
  sleep 2
  echo "  Copilot SSH session stopped (PID: $COPILOT_PID)"
else
  echo "  No running Copilot session found"
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
cd ~/gh-cli-telegram-extension 2>/dev/null && git pull 2>&1 || echo "  No local repo to update"
cd ~

# ── Fix line endings on scripts ──────────────────────────────────────────────
for f in ~/setup-sandbox.sh ~/sandbox-setup.sh ~/sandbox-policy.yaml; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

# ── Run sandbox setup (creates providers + sandbox + starts copilot) ─────────
echo ">>> Running sandbox setup..."
bash ~/setup-sandbox.sh

echo "=== Sandbox Reset completed at $(date -u) ==="
