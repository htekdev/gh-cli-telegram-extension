#!/bin/bash
# sandbox-setup.sh — Runs INSIDE the OpenShell sandbox.
# Configures git, clones repo, generates MCP config, starts Copilot CLI.
#
# ALL credentials are injected as env vars by OpenShell providers:
#   GH_TOKEN, COPILOT_GITHUB_TOKEN, TELEGRAM_BOT_TOKEN,
#   EXA_API_KEY, PERPLEXITY_API_KEY, YOUTUBE_API_KEY, ZERNIO_API_KEY

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
  echo "  WARNING: raw secrets not found — TELEGRAM_BOT_TOKEN may be a resolver string"
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

# ── Clone repo ───────────────────────────────────────────────────────────────
echo ">>> Cloning gh-cli-telegram-extension..."
if [ -d ~/gh-cli-telegram-extension ]; then
  echo "  Already exists, pulling latest"
  cd ~/gh-cli-telegram-extension && git pull
else
  git clone https://github.com/htekdev/gh-cli-telegram-extension.git ~/gh-cli-telegram-extension
fi
cd ~/gh-cli-telegram-extension
echo "  Repo ready"

# ── Create .env for Telegram bridge extension ────────────────────────────────
echo ">>> Creating .env..."
cat > ~/gh-cli-telegram-extension/.env << DOTENVEOF
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=7729308746
DOTENVEOF
chmod 600 ~/gh-cli-telegram-extension/.env
echo "  .env created"

# ── Pre-trust the repo directory ──────────────────────────────────────────────
# Copilot prompts "do you trust this directory?" on first launch.
# --yolo handles tool permissions but NOT directory trust. Pre-configure it.
echo ">>> Pre-trusting repo directory..."
mkdir -p ~/.copilot
cat > ~/.copilot/config.json << CFGEOF
{
  "trusted_folders": ["/sandbox/gh-cli-telegram-extension"]
}
CFGEOF
echo "  Directory pre-trusted"

# ── Generate MCP config ─────────────────────────────────────────────────────
# All env vars are injected by OpenShell providers at runtime.
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
echo "  Repo: ~/gh-cli-telegram-extension"
echo "  MCP:  ~/.copilot/mcp-config.json"
