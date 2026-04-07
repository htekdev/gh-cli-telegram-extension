#!/usr/bin/env bash
# bootstrap.sh — EC2 user-data script
# Runs as root on first boot (Ubuntu 24.04). Variables injected by Terraform templatefile.
#
# Installs: Docker, Node.js 22, pnpm, GitHub CLI, OpenShell
# Then hands off to setup-sandbox.sh to create an OpenShell sandbox running the standalone Telegram bridge service
set -euo pipefail

# ── Deploy status sentinel ───────────────────────────────────────────────────
DEPLOY_STATUS="failure"
DEPLOY_ERROR="Bootstrap did not complete"
write_sentinel() {
  cat > /home/ubuntu/.deploy-status << SENTINEL_EOF
{"status":"$DEPLOY_STATUS","timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","error":"$DEPLOY_ERROR"}
SENTINEL_EOF
  chmod 644 /home/ubuntu/.deploy-status
  chown ubuntu:ubuntu /home/ubuntu/.deploy-status 2>/dev/null || true
}
trap write_sentinel EXIT

# ── Terraform-injected variables ─────────────────────────────────────────────
GH_TOKEN="${gh_token}"
COPILOT_GITHUB_TOKEN="${copilot_github_token}"
TELEGRAM_BOT_TOKEN="${telegram_bot_token}"
EXA_API_KEY="${exa_api_key}"
PERPLEXITY_API_KEY="${perplexity_api_key}"
YOUTUBE_API_KEY="${youtube_api_key}"
ZERNIO_API_KEY="${zernio_api_key}"
SLACK_BOT_TOKEN="${slack_bot_token}"
SLACK_APP_TOKEN="${slack_app_token}"
PROJECT_NAME="${project_name}"
GIT_REF="${git_ref}"
GIT_REPO="${git_repo}"

LOG="/var/log/bootstrap.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== Bootstrap started at $(date -u) ==="
echo "Project: $PROJECT_NAME"

# ── System packages ──────────────────────────────────────────────────────────
echo ">>> Updating apt and installing prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release jq unzip git \
  apt-transport-https software-properties-common \
  build-essential python3 python3-pip

# ── Node.js 22 via NodeSource ────────────────────────────────────────────────
echo ">>> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
echo "Node: $(node --version), npm: $(npm --version)"

# ── pnpm via corepack ────────────────────────────────────────────────────────
echo ">>> Enabling pnpm via corepack..."
corepack enable
su - ubuntu -c 'corepack prepare pnpm@latest --activate'
echo "pnpm installed"

# ── Docker ───────────────────────────────────────────────────────────────────
echo ">>> Installing Docker..."
apt-get install -y docker.io
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu
echo "Docker: $(docker --version)"

# ── GitHub CLI ───────────────────────────────────────────────────────────────
echo ">>> Installing GitHub CLI..."
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null
apt-get update -y
apt-get install -y gh
echo "gh CLI: $(gh --version | head -1)"

# ── OpenShell ────────────────────────────────────────────────────────────────
echo ">>> Installing OpenShell (latest)..."
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \
  | su - ubuntu -c 'sh'
echo "OpenShell installed"

# ── Write temp credential files for provider creation ────────────────────────
# Each file holds a single API key. setup-sandbox.sh reads them to create
# OpenShell providers, then deletes them immediately.
echo ">>> Writing credential files for providers..."
for pair in \
  "copilot-token:$COPILOT_GITHUB_TOKEN" \
  "github-token:$GH_TOKEN" \
  "exa-key:$EXA_API_KEY" \
  "perplexity-key:$PERPLEXITY_API_KEY" \
  "youtube-key:$YOUTUBE_API_KEY" \
  "zernio-key:$ZERNIO_API_KEY"; do
  FILE="/home/ubuntu/$(echo "$pair" | cut -d: -f1)"
  VALUE="$(echo "$pair" | cut -d: -f2-)"
  echo "$VALUE" > "$FILE"
  chmod 600 "$FILE"
  chown ubuntu:ubuntu "$FILE"
done
echo "  Credential files written"

# ── Write raw secrets for sandbox upload ─────────────────────────────────────
# Provider env vars in SSH sessions resolve to openshell:resolve:... strings,
# not raw values. TELEGRAM_BOT_TOKEN and Slack tokens must be written as raw
# values so the bridge .env file can consume them. GIT_REF and GIT_REPO are
# also included here to avoid additional uploads via OpenShell.
echo ">>> Writing raw secrets..."
cat > /home/ubuntu/raw-secrets.env << ENVEOF
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN
SLACK_APP_TOKEN=$SLACK_APP_TOKEN
GIT_REF=$GIT_REF
GIT_REPO=$GIT_REPO
ENVEOF
chmod 600 /home/ubuntu/raw-secrets.env
chown ubuntu:ubuntu /home/ubuntu/raw-secrets.env

# ── Write host .env (for reference/debugging) ────────────────────────────────
echo ">>> Writing host .env..."
cat > /home/ubuntu/.env << ENVEOF
GH_TOKEN=$GH_TOKEN
COPILOT_GITHUB_TOKEN=$COPILOT_GITHUB_TOKEN
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
EXA_API_KEY=$EXA_API_KEY
PERPLEXITY_API_KEY=$PERPLEXITY_API_KEY
YOUTUBE_API_KEY=$YOUTUBE_API_KEY
ZERNIO_API_KEY=$ZERNIO_API_KEY
ENVEOF
chmod 600 /home/ubuntu/.env
chown ubuntu:ubuntu /home/ubuntu/.env

# ── PATH + .env in shell profile ─────────────────────────────────────────────
echo ">>> Configuring shell profile..."
su - ubuntu -c 'cat >> ~/.bashrc << '\''PROFILEEOF'\''

# OpenShell + API keys
export PATH="$HOME/.local/bin:$PATH"
set -a
[ -f ~/.env ] && source ~/.env
set +a
PROFILEEOF'

# ── Authenticate gh CLI ─────────────────────────────────────────────────────
echo ">>> Authenticating gh CLI..."
su - ubuntu -c "echo '$GH_TOKEN' | gh auth login --with-token" || echo "  gh auth skipped"

# ── Write git ref and repo for sandbox setup ─────────────────────────────────
echo ">>> Writing git deployment info..."
echo "$GIT_REF" > /home/ubuntu/git-ref
echo "$GIT_REPO" > /home/ubuntu/git-repo
chmod 644 /home/ubuntu/git-ref /home/ubuntu/git-repo
chown ubuntu:ubuntu /home/ubuntu/git-ref /home/ubuntu/git-repo

# ── Fix line endings on uploaded scripts ─────────────────────────────────────
# File provisioners on Windows upload with CRLF — bash chokes on \r.
echo ">>> Fixing line endings on uploaded scripts..."
for f in /home/ubuntu/*.sh /home/ubuntu/*.yaml /home/ubuntu/*.env; do
  [ -f "$f" ] && sed -i 's/\r$//' "$f"
done

# ── Run sandbox setup (creates providers + sandbox + starts bridge service) ─
echo ">>> Running sandbox setup..."
su - ubuntu -c 'bash /home/ubuntu/setup-sandbox.sh'

DEPLOY_STATUS="success"
DEPLOY_ERROR=""

echo "=== Bootstrap completed at $(date -u) ==="
