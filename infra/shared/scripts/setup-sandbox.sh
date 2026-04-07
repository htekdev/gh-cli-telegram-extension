#!/usr/bin/env bash
# setup-sandbox.sh — Runs on the HOST as ubuntu user.
# Called from bootstrap.sh. Creates OpenShell providers, provisions a sandbox,
# uploads raw secrets, runs sandbox-setup.sh inside it, then starts the bridge.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

echo "=== Sandbox Setup started at $(date -u) ==="

# ── Start OpenShell gateway ──────────────────────────────────────────────────
echo ">>> Starting OpenShell gateway..."
openshell gateway start 2>&1 || true

# ── Fix DNS for kube-dns (OpenShell #437 workaround) ─────────────────────────
echo ">>> Fixing DNS..."
sg docker -c 'docker exec openshell-cluster-openshell sh -c \
  "echo nameserver 8.8.8.8 > /etc/rancher/k3s/resolv.conf"' 2>/dev/null || true

# ── Create providers ─────────────────────────────────────────────────────────
echo ">>> Creating OpenShell providers..."

declare -A PROVIDERS=(
  ["copilot"]="COPILOT_GITHUB_TOKEN"
  ["github"]="GH_TOKEN"
  ["exa"]="EXA_API_KEY"
  ["perplexity"]="PERPLEXITY_API_KEY"
  ["youtube"]="YOUTUBE_API_KEY"
  ["zernio"]="ZERNIO_API_KEY"
)

declare -A KEY_FILES=(
  ["copilot"]="copilot-token"
  ["github"]="github-token"
  ["exa"]="exa-key"
  ["perplexity"]="perplexity-key"
  ["youtube"]="youtube-key"
  ["zernio"]="zernio-key"
)

for PROV_NAME in copilot github exa perplexity youtube zernio; do
  KEY_FILE="$HOME/${KEY_FILES[$PROV_NAME]}"
  CRED_NAME="${PROVIDERS[$PROV_NAME]}"
  KEY_VAL=$(cat "$KEY_FILE" 2>/dev/null || true)

  if [ -n "$KEY_VAL" ]; then
    if [ "$PROV_NAME" = "github" ]; then
      # gh CLI uses GH_TOKEN, github-mcp-server uses GITHUB_TOKEN
      openshell provider create --name "$PROV_NAME" --type generic \
        --credential "GH_TOKEN=${KEY_VAL}" \
        --credential "GITHUB_TOKEN=${KEY_VAL}" 2>&1
    else
      openshell provider create --name "$PROV_NAME" --type generic \
        --credential "${CRED_NAME}=${KEY_VAL}" 2>&1
    fi
    rm -f "$KEY_FILE"
    echo "  $PROV_NAME provider created"
  else
    echo "  WARNING: $PROV_NAME key file not found ($KEY_FILE), skipping"
  fi
done

# ── Create sandbox ───────────────────────────────────────────────────────────
echo ">>> Creating OpenShell sandbox (~2 min, pulls base image)..."
openshell sandbox create \
  --policy "$HOME/sandbox-policy.yaml" \
  --provider copilot \
  --provider github \
  --provider exa \
  --provider perplexity \
  --provider youtube \
  --provider zernio \
  --no-tty \
  --keep \
  -- true
echo "  Sandbox created"

# ── Get sandbox name ─────────────────────────────────────────────────────────
SANDBOX_NAME=$(openshell sandbox list 2>/dev/null | tail -n +2 | awk '{print $1}' | head -1)
if [ -z "$SANDBOX_NAME" ]; then
  echo "ERROR: No sandbox found after create" >&2
  exit 1
fi
echo ">>> Sandbox: $SANDBOX_NAME"
echo "$SANDBOX_NAME" > "$HOME/.sandbox-name"

# ── Upload raw secrets into sandbox ───────────────────────────────────────────
# Contains TELEGRAM_BOT_TOKEN and, on initial bootstrap, Slack tokens and
# deployment metadata (GIT_REF/GIT_REPO). Resets currently rehydrate only
# TELEGRAM_BOT_TOKEN; other values fall back to defaults.
echo ">>> Uploading raw secrets into sandbox..."
openshell sandbox upload "$SANDBOX_NAME" "$HOME/raw-secrets.env" /sandbox/secrets 2>&1
echo "  Secrets uploaded"

# ── Run internal setup via SSH proxy ─────────────────────────────────────────
# Pipe the setup script via stdin to avoid openshell upload path issues
echo ">>> Running setup inside sandbox..."
cat "$HOME/sandbox-setup.sh" | \
  ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o "ProxyCommand=$HOME/.local/bin/openshell ssh-proxy --gateway-name openshell --name $SANDBOX_NAME" \
    "sandbox@$SANDBOX_NAME" "bash -s"

# ── Start bridge service inside sandbox ───────────────────────────────────────
# The bridge service is a standalone Node.js process that creates CopilotClient
# internally. No need for TTY allocation (-tt) since it's not interactive.
echo ">>> Starting bridge service inside sandbox..."
nohup ssh -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=1000 \
    -o "ProxyCommand=$HOME/.local/bin/openshell ssh-proxy --gateway-name openshell --name $SANDBOX_NAME" \
    "sandbox@$SANDBOX_NAME" \
    "cd ~/copilot-telegram-bridge && npm start" \
    > /home/ubuntu/bridge-service.log 2>&1 &
BRIDGE_PID=$!
echo "$BRIDGE_PID" > /home/ubuntu/.bridge-pid
sleep 5
if kill -0 "$BRIDGE_PID" 2>/dev/null; then
  echo "  Bridge launch SSH session is running (PID: $BRIDGE_PID)"
  echo "  Log: ~/bridge-service.log"
else
  echo "  WARNING: Bridge SSH session may not have started — check ~/bridge-service.log"
fi

echo "=== Sandbox Setup completed at $(date -u) ==="
