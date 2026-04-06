# 🤖 Telegram ↔ GitHub Copilot CLI Bridge

**Who needs OpenClaw when you have GitHub Copilot CLI Extensions?**

[OpenClaw](https://github.com/openclaw/openclaw) is a fantastic project — a full personal AI assistant framework with a gateway daemon, 20+ channel integrations (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, IRC, Matrix...), companion apps, voice wake words, a live canvas, multi-agent routing, onboarding wizards, and thousands of lines of infrastructure code.

**This project does the same core thing in a single file — and deploys it securely to the cloud with one command.**

One `.mjs` extension. ~420 lines. No gateway. No daemon. Deployed inside an [NVIDIA OpenShell](https://github.com/NVIDIA/OpenShell) sandbox with policy-enforced networking, L7 credential injection, and full IaC automation via Terraform. `terraform apply` → 10 minutes → a secure, sandboxed Copilot CLI agent on Telegram.

## What We Built

### Phase 1: The Extension

A Copilot CLI extension that bridges Telegram to your active session using long polling. The SDK gives you `session.send()` to inject prompts, `session.on("assistant.message")` to capture responses, and a full Node.js runtime. That's all you need.

### Phase 2: Safe OpenClaw (Current)

Infrastructure as Code that deploys Copilot CLI inside an OpenShell sandbox on AWS, connected to Telegram — a secure, automated alternative to OpenClaw.

```
┌──────────────────────────────────────────────────────────────┐
│  AWS EC2 (Ubuntu 24.04, t3.medium)                           │
│  Docker + OpenShell gateway                                   │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  OpenShell Sandbox (policy-enforced)                   │   │
│  │                                                        │   │
│  │  Copilot CLI --yolo --autopilot --experimental         │   │
│  │  Telegram Bridge Extension (this repo)                 │   │
│  │                                                        │   │
│  │  Providers (credentials injected at runtime):          │   │
│  │    copilot  → GitHub Copilot API                       │   │
│  │    github   → GitHub API + git                         │   │
│  │    exa      → Exa AI search                            │   │
│  │    perplexity → Perplexity AI research                 │   │
│  │    youtube  → YouTube Data API                         │   │
│  │    zernio   → Zernio social media                      │   │
│  │                                                        │   │
│  │  MCP Servers: exa, perplexity, youtube, mslearn        │   │
│  │                                                        │   │
│  │  Network Policy (default deny):                        │   │
│  │  ✅ GitHub API (L7 credential injection)               │   │
│  │  ✅ Copilot API (TCP passthrough)                      │   │
│  │  ✅ Telegram Bot API                                   │   │
│  │  ✅ Exa, Perplexity, YouTube, Zernio (L7)             │   │
│  │  ✅ npm registry                                       │   │
│  │  ❌ Everything else (blocked)                          │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Zero manual steps.** `terraform apply` handles everything:
1. Provisions EC2 instance (Ubuntu 24.04)
2. Installs Docker, Node.js 22, pnpm, gh CLI, OpenShell
3. Creates 6 OpenShell providers for credential injection
4. Creates sandbox with network policy
5. Clones this repo inside sandbox
6. Generates MCP config from injected env vars
7. Pre-trusts the repo directory + enables experimental mode
8. Starts Copilot CLI with `--yolo --autopilot --no-ask-user --experimental`
9. Telegram bridge extension auto-loads and begins polling

**~10 minutes from `terraform apply` to a live agent on Telegram.**

## What It Does

```
┌──────────────┐    long polling     ┌──────────────┐    session.send()    ┌──────────────┐
│   Telegram   │ ◄─────────────────► │   Extension  │ ◄──────────────────► │  Copilot CLI │
│  (your phone)│   getUpdates       │  (bridge)    │   assistant.message  │  (session)   │
└──────────────┘   sendMessage       └──────────────┘                      └──────────────┘
```

- **📱 → 💻**: Send a message on Telegram → it becomes a real user prompt in the Copilot CLI session
- **💻 → 📱**: Copilot responds → the response is automatically forwarded to Telegram
- **Full power**: The agent can read/write files, run commands, search code, create PRs, query GitHub — everything it can do locally, you can trigger from Telegram

## Quick Start

### Local Mode (extension only)

1. Message [@BotFather](https://t.me/BotFather) on Telegram, create a bot, copy the token
2. `cp .env.example .env` and paste your bot token
3. Start `copilot --experimental` in this repo — extension loads automatically
4. Send `/start` to your bot on Telegram

### Cloud Mode (OpenShell sandbox on AWS)

#### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS CLI configured with EC2 permissions
- Key pair named `gh-copilot-openclaw-key`

#### Deploy

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# Fill in your API keys (see terraform.tfvars.example for list)
terraform init && terraform apply
```

In ~10 minutes your agent is live on Telegram. No SSH needed. No manual steps.

#### SSH In (for debugging)

```bash
ssh -i gh-copilot-openclaw-key.pem ubuntu@$(cd infra/aws && terraform output -raw public_ip)

# Connect to sandbox
export PATH=$HOME/.local/bin:$PATH
openshell sandbox connect $(cat ~/.sandbox-name)

# Check Copilot log
tail -f ~/copilot-session.log

# Check extension polling
openshell logs $(cat ~/.sandbox-name) --since 5m | grep telegram
```

#### Cost

| Running 24/7 | Stopped |
|-------------|---------|
| ~$30/mo (t3.medium) | ~$1.60/mo (EBS only) |

#### Destroy

```bash
cd infra/aws && terraform destroy
```

## OpenClaw vs. This Project

| | OpenClaw | This Project |
|---|---------|-------------|
| **Setup** | `npm install -g openclaw`, onboarding wizard, gateway daemon, systemd/launchd | `terraform apply` — one command, zero manual steps |
| **Infrastructure** | Gateway server, WebSocket control plane, session model, media pipeline | OpenShell sandbox + Copilot CLI + one extension file |
| **Security** | Manual configuration, API keys stored on disk | OpenShell policy-enforced networking, L7 credential injection, default-deny |
| **Agent** | Custom Pi agent runtime | GitHub Copilot — the best coding agent available |
| **Channels** | 20+ (WhatsApp, Telegram, Slack, Discord, Signal, etc.) | 1 (Telegram). Adding more = adding extension files |
| **Tools** | Custom skill system | Full Copilot CLI ecosystem + MCP servers |
| **Code** | Thousands of lines across gateway, channels, agent, CLI | ~420 lines (extension) + ~300 lines (IaC scripts) |
| **Cloud deploy** | Manual VM setup, systemd services, interactive auth | `terraform apply` — fully automated |

## File Structure

```
.github/extensions/telegram-bridge/
  extension.mjs              ← Telegram bridge (single file, ~500 lines)
.github/extensions/cron-scheduler/
  extension.mjs              ← Scheduled tasks (pure JS cron, ~220 lines)
cron.json                    ← Cron job definitions (timezone + schedule + prompt)
infra/
  aws/                       ← AWS Terraform root module
    main.tf                  ← EC2 + security group + file provisioners
    variables.tf             ← Input variables (7 API keys + instance config)
    outputs.tf               ← IP, SSH command, sandbox connect instructions
    terraform.tfvars.example ← Template (committed)
  shared/
    files/
      sandbox-policy.yaml    ← OpenShell network policy (default deny + allowlist)
    scripts/
      bootstrap.sh           ← VM user-data: Docker, Node.js, OpenShell, providers
      setup-sandbox.sh       ← Host-side: create sandbox, upload secrets, start copilot
      sandbox-setup.sh       ← Sandbox-side: git config, clone repo, .env, MCP config
.env                         ← Your bot token (gitignored)
.env.example                 ← Template
```

## Key Technical Details

### Credential Management

All credentials are injected via **OpenShell providers** — named credential bundles that are injected as environment variables at runtime. Credentials never touch the sandbox filesystem.

| Provider | Env Var | Used By |
|----------|---------|---------|
| copilot | `COPILOT_GITHUB_TOKEN` | Copilot CLI auth |
| github | `GH_TOKEN` | gh CLI, git clone |
| exa | `EXA_API_KEY` | Exa MCP server |
| perplexity | `PERPLEXITY_API_KEY` | Perplexity MCP server |
| youtube | `YOUTUBE_API_KEY` | YouTube MCP server |
| zernio | `ZERNIO_API_KEY` | Zernio CLI |

**Exception:** `TELEGRAM_BOT_TOKEN` is delivered via a raw secrets file uploaded into the sandbox because the extension reads it from a `.env` file (provider resolver strings don't work as raw token values).

### Network Policy

The sandbox enforces **default-deny** networking. Only explicitly allowlisted endpoints are reachable:

| Endpoint | Mode | Why |
|----------|------|-----|
| GitHub API | L7 (tls:terminate) | Credential injection via proxy |
| GitHub git | L7 (tls:terminate) | Credential injection for clone/push |
| Copilot API | TCP passthrough | Avoids HTTP/2 coalescing → 421 errors |
| Telegram | TCP passthrough | Avoids L7 issues with binary payloads |
| Exa, Perplexity, YouTube, Zernio | L7 (tls:terminate) | Credential injection |
| MS Learn | TCP passthrough | Public, no auth needed |
| npm registry | TCP passthrough | Package installs |

### Lessons Learned

- **Extensions require `--experimental`** — the `EXTENSIONS` feature flag is gated behind experimental mode
- **OpenShell providers inject resolver strings in SSH sessions** — not raw values. Files that need raw tokens (`.env`) must use uploaded secrets
- **OpenShell `sandbox upload` creates nested directories** — pipe scripts via SSH stdin instead
- **Copilot needs directory trust before loading extensions** — pre-configure `trusted_folders` in `~/.copilot/config.json`
- **`ssh -tt` keeps Copilot alive** — `nohup` kills the TTY which Copilot requires for interactive mode
- **Copilot base image may be outdated** — install latest via `npm install -g @github/copilot` to user-writable prefix

## Scheduled Tasks (Cron)

The **cron-scheduler** extension runs scheduled prompts automatically. Define jobs in `cron.json`:

```json
{
  "timezone": "America/Chicago",
  "jobs": [
    {
      "id": "daily-standup",
      "schedule": "0 9 * * 1-5",
      "prompt": "Daily standup: check GitHub notifications, open PRs, assigned issues.",
      "enabled": true
    }
  ]
}
```

**Cron expression format:** `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|-----------|---------|
| `0 9 * * 1-5` | 9:00 AM weekdays |
| `0 17 * * 5` | 5:00 PM Fridays |
| `0 8 * * *` | 8:00 AM daily |
| `*/30 * * * *` | Every 30 minutes |
| `0 9,17 * * *` | 9 AM and 5 PM daily |

Supports: `*`, ranges (`1-5`), lists (`1,3,5`), steps (`*/15`). Timezone-aware via `Intl.DateTimeFormat`.

**Tools available to the agent:**
- `cron_list_jobs` — list all configured jobs with status
- `cron_next_run` — show when each enabled job fires next

Responses flow through the Telegram bridge automatically — scheduled task results appear in your Telegram chat.

## Future: Multi-Session Bridge Service ([#1](https://github.com/htekdev/gh-cli-telegram-extension/issues/1))

The current architecture is one extension → one session → one conversation. We're working on a **standalone bridge service** that enables:

### Multi-Session Conversations
```
┌─────────────────────────────────────────┐
│  Bridge Service (Node.js)               │
│                                         │
│  Telegram Poller ──→ Message Router     │
│                        ↓    ↓    ↓      │
│                      Sess1 Sess2 Sess3  │
│                      (CopilotClient SDK)│
│                                         │
│  Cron Scheduler ──→ Scheduled Prompts   │
└─────────────────────────────────────────┘
```

- **Multiple parallel sessions** via the `CopilotClient` SDK (`createSession` / `resumeSession`)
- **Telegram commands**: `/new` (create session), `/switch N` (resume), `/list` (show all)
- **Auto-routing** via Telegram reply threads or forum topics

### Scheduled Tasks
- `node-cron` for recurring prompts: daily standups, PR summaries, notification digests
- Configured via Telegram commands or config file

### Azure Support
- Azure Terraform module alongside the existing AWS module
- Same shared scripts and policy, different cloud provider

### Webhook Migration
- Switch from long polling to Telegram webhooks for cleaner multi-instance architecture
- Requires public URL (nginx reverse proxy or Cloudflare tunnel)

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + your chat ID |
| `/status` | Bridge connection status |
| `/help` | Available commands |

## Limitations

- Text messages only (photos, documents, voice not forwarded yet)
- One bot token = one polling consumer (Telegram API constraint)
- Single session per deployment (multi-session coming in [#1](https://github.com/htekdev/gh-cli-telegram-extension/issues/1))

## License

MIT
