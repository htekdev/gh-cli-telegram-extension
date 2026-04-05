#!/usr/bin/env bash
# setup-sandbox.sh — Runs on the HOST as ubuntu user.
# Creates OpenShell providers, sandbox, and runs internal setup.
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
  ["telegram"]="TELEGRAM_BOT_TOKEN"
  ["exa"]="EXA_API_KEY"
  ["perplexity"]="PERPLEXITY_API_KEY"
  ["youtube"]="YOUTUBE_API_KEY"
  ["zernio"]="ZERNIO_API_KEY"
)

declare -A KEY_FILES=(
  ["copilot"]="copilot-token"
  ["github"]="github-token"
  ["telegram"]="telegram-token"
  ["exa"]="exa-key"
  ["perplexity"]="perplexity-key"
  ["youtube"]="youtube-key"
  ["zernio"]="zernio-key"
)

for PROV_NAME in copilot github telegram exa perplexity youtube zernio; do
  KEY_FILE="$HOME/${KEY_FILES[$PROV_NAME]}"
  CRED_NAME="${PROVIDERS[$PROV_NAME]}"
  KEY_VAL=$(cat "$KEY_FILE" 2>/dev/null || true)

  if [ -n "$KEY_VAL" ]; then
    openshell provider create --name "$PROV_NAME" --type generic \
      --credential "${CRED_NAME}=${KEY_VAL}" 2>&1
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
  --provider telegram \
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

# ── Upload raw secrets into sandbox ──────────────────────────────────────────
# TELEGRAM_BOT_TOKEN needs raw value for .env (provider gives resolver string)
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

# ── Start Copilot CLI inside sandbox ─────────────────────────────────────────
# SSH with -tt forces TTY allocation, keeping copilot's interactive mode alive.
# The SSH command is backgrounded on the host with nohup so it survives
# the bootstrap SSH session ending.
echo ">>> Starting Copilot CLI inside sandbox..."
nohup ssh -tt -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=1000 \
    -o "ProxyCommand=$HOME/.local/bin/openshell ssh-proxy --gateway-name openshell --name $SANDBOX_NAME" \
    "sandbox@$SANDBOX_NAME" \
    "cd ~/gh-cli-telegram-extension && unset TELEGRAM_BOT_TOKEN && copilot --yolo --autopilot --no-ask-user -i 'You are now connected via the Telegram bridge. Say hello to Telegram.'" \
    > /home/ubuntu/copilot-session.log 2>&1 &
COPILOT_SSH_PID=$!
echo "$COPILOT_SSH_PID" > /home/ubuntu/.copilot-pid
sleep 5
if kill -0 "$COPILOT_SSH_PID" 2>/dev/null; then
  echo "  Copilot CLI started (host SSH PID: $COPILOT_SSH_PID)"
  echo "  Log: ~/copilot-session.log"
else
  echo "  WARNING: Copilot may not have started — check ~/copilot-session.log"
fi

echo "=== Sandbox Setup completed at $(date -u) ==="
