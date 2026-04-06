# 🤖 Telegram ↔ GitHub Copilot Multi-Session Bridge

**A standalone bridge service that manages multiple parallel Copilot sessions via Telegram, powered by the CopilotClient SDK.**

Built as the successor to the [extension-based bridge](https://github.com/htekdev/gh-cli-telegram-extension) — moving from a single-session Copilot CLI extension to a standalone Node.js service with N parallel sessions, scheduled tasks, and commit-pinned deployments.

## What Changed

| | Extension-based (old) | CopilotClient SDK (this repo) |
|---|---|---|
| **Architecture** | Copilot CLI extension (`joinSession`) | Standalone Node.js service (`CopilotClient`) |
| **Sessions** | 1 session per deployment | N parallel sessions per chat |
| **Entry point** | `copilot --yolo --experimental` | `npm start` → CopilotClient spawns CLI |
| **Multi-session** | Not possible | `/new`, `/switch N`, `/list`, `/end` |
| **Session persistence** | None | SDK-managed (`resumeSession` across restarts) |
| **Deployment** | Extension auto-loads on CLI start | `npm install && npm run build && npm start` |
| **Context limits** | Manual | Infinite sessions with auto-compaction |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Bridge Service (Node.js / TypeScript)              │
│                                                     │
│  ┌──────────┐     ┌──────────────┐                  │
│  │ Telegram  │────→│ Message      │                  │
│  │ Poller    │     │ Router       │                  │
│  └──────────┘     └──┬───┬───┬───┘                  │
│                      │   │   │                       │
│              ┌───────▼┐ ┌▼──┐┌▼──────┐              │
│              │Session 1│ │S2 ││S3     │              │
│              │(active) │ │   ││       │              │
│              └─────────┘ └───┘└───────┘              │
│                  CopilotClient SDK                   │
│                                                     │
│  ┌──────────┐     ┌──────────────┐                  │
│  │ Cron     │────→│ Scheduled    │                  │
│  │Scheduler │     │ Prompts      │                  │
│  └──────────┘     └──────────────┘                  │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/htekdev/gh-cli-telegram-extension.git
cd gh-cli-telegram-extension
npm install

# 2. Configure
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN (from @BotFather)

# 3. Build and run
npm run build
npm start
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | No | Lock to a specific chat ID (recommended) |
| `CLI_URL` | No | Connect to existing headless CLI (e.g., `localhost:4321`) |
| `CLI_PORT` | No | Port for CopilotClient server |
| `CRON_ENABLED` | No | Enable cron scheduler (`true`/`false`, default: `false`) |
| `LOG_LEVEL` | No | Log level (`debug`/`info`/`warn`/`error`, default: `info`) |

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message, creates first session |
| `/new` | Create a new parallel session |
| `/switch N` | Switch to session N (from `/list`) |
| `/list` | List all sessions with index and age |
| `/end` | End current session |
| `/status` | Bridge and session status |
| `/help` | Command reference |

## Scheduled Tasks (Cron)

Define jobs in `cron.json`:

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

Set `CRON_ENABLED=true` in `.env` to activate. Jobs are hot-reloaded when `cron.json` changes.

## Cloud Deployment (OpenShell on AWS)

### Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5
- AWS CLI configured with EC2 permissions
- Key pair named `gh-copilot-openclaw-key`

### Deploy

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# Fill in API keys
terraform init && terraform apply
```

### Commit-Pinned Deployments

The deploy workflow passes `GITHUB_SHA` (or PR head SHA) through Terraform to the sandbox. The sandbox clones the repo and checks out the exact commit:

```
deploy.yml → TF_VAR_git_ref=$GITHUB_SHA
  → bootstrap.sh → sandbox-setup.sh
    → git clone && git checkout $GIT_REF
    → npm install && npm run build && npm start
```

This ensures PRs deploy their own code, and production always runs the merged commit.

## File Structure

```
src/
  index.ts              — Entry point: wires config → client → poller → cron
  config.ts             — .env loading + Zod validation
  telegram/
    api.ts              — Telegram Bot API helpers (typed)
    poller.ts           — Long polling with backoff and conflict handling
    commands.ts         — /new, /switch, /list, /end, /start, /status, /help
    router.ts           — Routes messages to active session (text + photos)
  sessions/
    manager.ts          — CopilotClient lifecycle (create/resume/switch/end)
    types.ts            — Session metadata types
  cron/
    parser.ts           — Cron expression parser (5-field, pure JS)
    scheduler.ts        — Scheduled prompt runner with file watching
package.json
tsconfig.json
vitest.config.ts
cron.json               — Cron job definitions
.env.example            — Environment variable template
infra/
  aws/                  — Terraform root module
    main.tf             — EC2 + security group
    variables.tf        — Input variables (API keys + git_ref + git_repo)
    outputs.tf          — IP, SSH command
  shared/
    files/
      sandbox-policy.yaml — OpenShell network policy
    scripts/
      bootstrap.sh      — VM user-data: Docker, Node.js, OpenShell
      setup-sandbox.sh  — Host-side: providers, sandbox, start bridge
      sandbox-setup.sh  — Sandbox-side: clone, build, .env, MCP config
      reset-sandbox.sh  — Destroy and recreate sandbox
```

## Key Technical Details

### Session Management

- Sessions use structured IDs: `tg-{chatId}-{timestamp}`
- First message auto-creates a session (no `/new` needed)
- Infinite sessions enabled for long-running conversations (auto-compaction at 80% context)
- Per-chat mutex prevents concurrent session creation races
- Sessions persist across restarts via CopilotClient SDK

### Credential Management

All credentials are injected via **OpenShell providers** at runtime. `TELEGRAM_BOT_TOKEN` is delivered via raw secrets file (provider resolver strings don't work as raw token values).

### Network Policy

Default-deny sandbox networking. Only Telegram, GitHub, Copilot, Exa, Perplexity, YouTube, Zernio, MS Learn, and npm registry are reachable.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm start            # Run the bridge service
npm test             # Run tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

## License

MIT
