#!/bin/bash
# sandbox-setup.sh — Runs INSIDE the OpenShell sandbox.
# Configures git, clones repo, builds service, generates MCP config.
set -euo pipefail
#
# Credentials and deploy metadata are injected as env vars via OpenShell
# providers and raw-secrets.env (loaded below), including GH_TOKEN,
# COPILOT_GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, SLACK_APP_TOKEN,
# EXA_API_KEY, PERPLEXITY_API_KEY, YOUTUBE_API_KEY, ZERNIO_API_KEY, GIT_REF, GIT_REPO

echo "=== Sandbox internal setup started ==="

# ── Load raw secrets ─────────────────────────────────────────────────────────
# TELEGRAM_BOT_TOKEN must come from raw secrets file, not provider env var,
# because provider env vars in SSH sessions are resolver strings, not raw values.
SECRETS_PATH=""
for p in /sandbox/secrets/raw-secrets.env /sandbox/secrets; do
  if [ -f "$p" ]; then SECRETS_PATH="$p"; break; fi
done
if [ -n "$SECRETS_PATH" ]; then
  set -a
  source "$SECRETS_PATH"
  set +a
  echo "  Raw secrets loaded from $SECRETS_PATH"
else
  echo "  WARNING: raw secrets not found — tokens such as TELEGRAM_BOT_TOKEN and Slack tokens may be resolver strings; GIT_REF/GIT_REPO will fall back to defaults"
fi

# ── Configure git ────────────────────────────────────────────────────────────
echo ">>> Configuring git..."
git config --global http.sslCAInfo /etc/openshell-tls/openshell-ca.pem

# Git credential helper uses provider-injected GH_TOKEN env var
cat > ~/.git-credential-github.sh << 'CREDEOF'
#!/bin/sh
[ -z "$GH_TOKEN" ] && exit 1
echo "protocol=https"
echo "host=github.com"
echo "username=x-access-token"
echo "password=$GH_TOKEN"
CREDEOF
chmod 700 ~/.git-credential-github.sh
git config --global credential.https://github.com.helper ~/.git-credential-github.sh
echo "  git configured"

# ── Authenticate gh CLI ─────────────────────────────────────────────────────
echo ">>> Authenticating gh CLI..."
echo "$GH_TOKEN" | gh auth login --with-token 2>&1 || echo "  gh auth skipped"

# ── Read git deployment info ──────────────────────────────────────────────────
# GIT_REF and GIT_REPO are sourced from raw-secrets.env above
GIT_REF="${GIT_REF:-main}"
GIT_REPO="${GIT_REPO:-https://github.com/htekdev/gh-cli-telegram-extension.git}"
REPO_DIR=~/copilot-telegram-bridge
echo "  Git ref: $GIT_REF"
echo "  Git repo: $GIT_REPO"

# ── Clone repo ───────────────────────────────────────────────────────────────
echo ">>> Cloning repo ($GIT_REPO @ $GIT_REF)..."
if [ -d "$REPO_DIR" ]; then
  echo "  Already exists, fetching latest"
  cd "$REPO_DIR" && git fetch origin
else
  git clone "$GIT_REPO" "$REPO_DIR"
fi
cd "$REPO_DIR"
git checkout "$GIT_REF"
echo "  Repo ready at $(git rev-parse --short HEAD)"

# ── Build the bridge service ─────────────────────────────────────────────────
echo ">>> Installing dependencies and building..."
npm install 2>&1
npm run build 2>&1
echo "  Build complete"

# ── Create .env for bridge service (Telegram + Slack, BRIDGE_MODE=standalone) ─
echo ">>> Creating .env..."
cat > "$REPO_DIR/.env" << DOTENVEOF
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=7729308746
SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN
SLACK_APP_TOKEN=$SLACK_APP_TOKEN
CRON_ENABLED=true
BRIDGE_MODE=standalone
DOTENVEOF
chmod 600 "$REPO_DIR/.env"
echo "  .env created"

# ── Pre-trust the repo directory ──────────────────────────────────────────────
# Copilot tooling prompts "do you trust this directory?" on first use.
# Pre-populate config so Copilot CLI/agents can run inside the sandbox non-interactively.
echo ">>> Pre-trusting repo directory..."
mkdir -p ~/.copilot
if [ -f ~/.copilot/config.json ]; then
  node -e '
    const fs = require("fs");
    const cfg = JSON.parse(fs.readFileSync(process.env.HOME + "/.copilot/config.json", "utf8"));
    cfg.trusted_folders = cfg.trusted_folders || [];
    if (!cfg.trusted_folders.includes("/sandbox/copilot-telegram-bridge")) {
      cfg.trusted_folders.push("/sandbox/copilot-telegram-bridge");
    }
    cfg.experimental = true;
    fs.writeFileSync(process.env.HOME + "/.copilot/config.json", JSON.stringify(cfg, null, 2));
  '
else
  echo '{"trusted_folders":["/sandbox/copilot-telegram-bridge"],"experimental":true}' > ~/.copilot/config.json
fi
echo "  Directory pre-trusted"

# ── Generate MCP config ─────────────────────────────────────────────────────
# All secrets are injected as env vars via providers/raw-secrets at runtime.
echo ">>> Generating MCP config..."
mkdir -p ~/.copilot

cat > ~/.copilot/mcp-config.json << MCPEOF
{
  "mcpServers": {
    "exa": {
      "tools": ["*"],
      "type": "http",
      "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,web_search_advanced_exa,get_code_context_exa,crawling_exa,company_research_exa,people_search_exa,deep_researcher_start,deep_researcher_check&exaApiKey=${EXA_API_KEY}"
    },
    "mslearn": {
      "tools": ["*"],
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp"
    },
    "perplexity": {
      "tools": ["*"],
      "type": "local",
      "command": "npx",
      "args": ["-y", "perplexity-mcp"],
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    },
    "youtube": {
      "tools": ["*"],
      "type": "local",
      "command": "npx",
      "args": ["-y", "@htekdev/youtube-mcp-server"],
      "env": {
        "YOUTUBE_API_KEY": "${YOUTUBE_API_KEY}"
      }
    }
  }
}
MCPEOF
echo "  MCP config generated"

echo "=== Sandbox setup complete ==="
echo "  Repo: $REPO_DIR ($(git rev-parse --short HEAD))"
echo "  MCP:  ~/.copilot/mcp-config.json"
