# 🚀 GitHub Copilot CLI Extensibility: From Extension to Service

**What can you build with GitHub Copilot CLI's extensibility model?**

This repo demonstrates the full spectrum — from a single `.mjs` extension file to a production-ready multi-channel bridge service, all powered by the same underlying SDK at different scales.

## Three Levels of Extensibility

### 🔧 **Extension Mode** — Single File, Zero Infrastructure
Drop one `.mjs` file in `.github/extensions/`, Copilot loads it automatically. Perfect for local dev and simple automations.

### 🏗️ **Service Mode** — When You Outgrow One Session  
Same SDK (`CopilotClient`), but now you manage N parallel sessions programmatically. Multi-channel support (Telegram + Slack), cron scheduling, session persistence.

### ☁️ **Cloud Mode** — Production-Ready Deployment
Wrap your service in OpenShell + Terraform for secure, automated deployment. Commit-pinned releases, default-deny networking, credential injection.

## The Bridge: Telegram + Slack ↔ Copilot

This specific implementation connects chat platforms to GitHub Copilot CLI:

**Extension Mode**: Single Telegram chat → One persistent Copilot session  
**Service Mode**: Multi-session via `/new`, `/switch`, Slack threads as sessions, per-job cron scheduling  
**Cloud Mode**: Deployed in OpenShell sandbox with L7 security policies

## Architecture Overview

```
Extension Mode (.mjs)          Service Mode (TypeScript)         Cloud Mode (OpenShell)
┌─────────────────┐           ┌────────────────────────────┐    ┌─────────────────────────┐
│ .github/        │           │ Bridge Service             │    │ AWS EC2 + OpenShell     │
│ extensions/     │           │ (Node.js/TypeScript)       │    │                         │
│                 │           │                            │    │ ┌─────────────────────┐ │
│ telegram-       │           │ ┌───────┐  ┌──────────┐    │    │ │    Sandbox          │ │
│ bridge.mjs      │           │ │Telegram│  │  Slack   │    │    │ │                     │ │
│                 │           │ │Poller │  │ Threads  │    │    │ │ ┌─────────────────┐ │ │
│ (one session)   │           │ └───┬───┘  └────┬─────┘    │    │ │ │ Bridge Service  │ │ │
└─────────────────┘           │     │           │          │    │ │ │                 │ │ │
                              │     └─────┬─────┘          │    │ │ │ N Sessions      │ │ │
┌─────────────────┐           │           ▼                │    │ │ │ Cron Jobs       │ │ │
│ joinSession()   │           │    ┌─────────────────┐     │    │ │ └─────────────────┘ │ │
│                 │           │    │ Session Manager │     │    │ │                     │ │
│ Simple hook     │           │    │                 │     │    │ │ Default-deny        │ │
│ Points:         │           │    │ S1  S2  S3      │     │    │ │ networking          │ │
│                 │           │    │(active)         │     │    │ └─────────────────────┘ │
│ • onMessage     │           │    └─────────────────┘     │    │                         │
│ • onCron        │           │     CopilotClient SDK      │    │ Terraform managed       │
│ • onPermission  │           └────────────────────────────┘    └─────────────────────────┘
└─────────────────┘
```

## Quick Start

### Extension Mode (Local Dev, Single Session)

1. Create `.github/extensions/telegram-bridge.mjs`:

```javascript
import { joinSession, approveAll } from "@github/copilot-sdk/extension";
import { TelegramApi } from "node-telegram-bot-api";

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => ({ 
      additionalContext: "This session is bridged to Telegram" 
    }),
    onUserPromptSubmitted: async (input) => {
      // Bridge Copilot responses back to Telegram
      // Your message routing logic here
    }
  }
});
```

2. Set `TELEGRAM_BOT_TOKEN` in environment
3. Run: `copilot --experimental`

### Service Mode (Multi-Session Production)

```bash
# 1. Clone and install
git clone https://github.com/htekdev/gh-cli-telegram-extension.git
cd gh-cli-telegram-extension
npm install

# 2. Configure
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN

# 3. Build and run  
npm run build
npm start
```

### Cloud Mode (OpenShell Deployment)

```bash
cd infra/aws
cp terraform.tfvars.example terraform.tfvars
# Fill in: telegram_bot_token, slack_bot_token, github_token
terraform init && terraform apply
```

### Environment Variables

| Variable | Extension | Service | Cloud | Description |
|----------|-----------|---------|-------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | ✅ | Bot token from [@BotFather](https://t.me/BotFather) |
| `SLACK_BOT_TOKEN` | — | ✅ | ✅ | Slack app bot token (`xoxb-...`) |
| `TELEGRAM_CHAT_ID` | ✅ | ⭕ | ⭕ | Lock to specific chat ID (recommended for extension mode) |
| `BRIDGE_MODE` | — | ⭕ | ⭕ | Set to `standalone` to disable extension auto-loading |
| `CLI_URL` | — | ⭕ | ⭕ | Connect to existing headless CLI (`localhost:4321`) |
| `CLI_PORT` | — | ⭕ | ⭕ | Port for CopilotClient server |
| `CRON_ENABLED` | — | ⭕ | ⭕ | Enable cron scheduler (`true`/`false`, default: `false`) |
| `SESSION_IDLE_TIMEOUT_MINUTES` | — | ⭕ | ⭕ | Auto-clean idle non-cron sessions after N minutes (`0` disables) |
| `LOG_LEVEL` | ⭕ | ⭕ | ⭕ | Log level (`debug`/`info`/`warn`/`error`) |

✅ = Required, ⭕ = Optional, — = Not applicable

## Features by Mode

### Extension Mode Features
- Single persistent Copilot session
- Basic Telegram message bridging  
- Simple cron job support via hooks
- Zero infrastructure requirements
- Perfect for personal automation

### Service Mode Features  
- **Multi-session management**: `/new`, `/switch N`, `/list`, `/end` commands
- **Dual-channel support**: Telegram commands + Slack threads (each thread = session)
- **Cron scheduling**: Per-job targeting (telegram/slack/all channels)
- **Session persistence**: Survives restarts via CopilotClient SDK
- **Dedicated cron sessions**: Background jobs with cross-session context hints
- **Concurrent session support**: Both channels can run simultaneously

### Cloud Mode Features
- **Commit-pinned deployments**: GITHUB_SHA flows through Terraform to sandbox
- **OpenShell security**: Default-deny networking with L7 policies
- **Credential injection**: Secrets delivered via OpenShell providers at runtime
- **Infrastructure as code**: Full Terraform deployment automation
- **Monitoring ready**: Structured logging and health checks

## Command Reference

### Telegram Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Welcome message, creates first session | `/start` |
| `/new` | Create a new parallel session | `/new` |
| `/switch N` | Switch to session N (from `/list`) | `/switch 2` |
| `/list` | List all sessions with index and age | `/list` |
| `/end` | End current session | `/end` |
| `/status` | Bridge and session status | `/status` |
| `/help` | Command reference | `/help` |

### Slack Integration

- **Each thread = One session**: Start conversation in any channel, replies stay in that session
- **Cross-thread context**: Cron jobs can hint at related conversations across threads
- **Simultaneous operation**: Telegram multi-session + Slack threads work together

## Scheduled Tasks (Cron)

Define jobs in `cron.json` with channel targeting:

```json
{
  "timezone": "America/Chicago", 
  "jobs": [
    {
      "id": "daily-standup",
      "schedule": "0 9 * * 1-5",
      "prompt": "Daily standup: check GitHub notifications, open PRs, assigned issues.",
      "target": "telegram",
      "enabled": true
    },
    {
      "id": "weekly-review", 
      "schedule": "0 17 * * 5",
      "prompt": "Weekly review: summarize completed work, plan next week priorities.",
      "target": "all",
      "enabled": true
    }
  ]
}
```

**Targets**: `telegram`, `slack`, `all`  
**Dedicated sessions**: Each cron job runs in its own session with cross-session context hints  
**Hot reload**: Jobs reload automatically when `cron.json` changes  
**Enable**: Set `CRON_ENABLED=true` in `.env`

## Implementation Details

### From Extension to Service: The SDK Evolution

**Extension (`joinSession`)**:
```javascript
import { joinSession, approveAll } from "@github/copilot-sdk/extension";

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onUserPromptSubmitted: async (input) => {
      // Single session, simple hooks
    }
  }
});
```

**Service (`CopilotClient`)**:
```typescript
import { CopilotClient } from "@github/copilot-sdk";

const client = new CopilotClient({
  cliUrl: "ws://localhost:4321"
});

// Manage N sessions programmatically
const session1 = await client.createSession();
const session2 = await client.resumeSession(sessionId);
```

**Key differences**:
- Extension: Copilot manages the session, you provide hooks
- Service: You manage sessions, Copilot provides the runtime

### Session Architecture

- **Session IDs**: Structured as `tg-{chatId}-{timestamp}` or `slack-{teamId}-{channelId}-{threadTs}`
- **First message auto-creates** session (no manual `/new` needed)
- **Infinite sessions** with auto-compaction at 80% context limit
- **Per-chat mutex** prevents concurrent session creation races
- **Cross-restart persistence** via CopilotClient SDK state management

### Security Model (Cloud Mode)

**OpenShell Sandbox**:
- Default-deny networking policy
- Only allows: Telegram, GitHub, Copilot APIs, npm registry
- Credential injection via L7 providers (no secrets in git)

**Network Policy** (`sandbox-policy.yaml`):
```yaml
networking:
  defaultAction: deny
  rules:
    - protocol: https
      host: "*.telegram.org" 
      action: allow
    - protocol: https
      host: "*.github.com"
      action: allow
```

## File Structure

```
src/                          # Service mode implementation
  index.ts                    # Entry: config → client → poller → cron
  config.ts                   # .env loading + Zod validation
  telegram/
    api.ts                    # Telegram Bot API helpers (typed)
    poller.ts                 # Long polling with backoff/conflict handling
    commands.ts               # Multi-session commands (/new, /switch, etc.)
    router.ts                 # Route messages to active session
  slack/
    app.ts                    # Slack Bolt app (thread-based sessions) 
    events.ts                 # Message/thread event handlers
  sessions/
    manager.ts                # CopilotClient lifecycle management
    types.ts                  # Session metadata types
  cron/
    parser.ts                 # Cron expression parser (5-field, pure JS)
    scheduler.ts              # Scheduled prompt runner + file watching

.github/
  extensions/                 # Extension mode examples
    telegram-bridge.mjs       # Single-file extension example
    slack-bridge.mjs          # Slack extension variant

infra/                       # Cloud mode deployment
  aws/
    main.tf                   # EC2 + security groups + OpenShell
    variables.tf              # Input vars (tokens + git_ref + git_repo)  
    outputs.tf                # SSH access info
  shared/
    files/
      sandbox-policy.yaml     # OpenShell network policy
    scripts/
      bootstrap.sh            # VM setup: Docker + Node.js + OpenShell
      sandbox-setup.sh        # Sandbox: clone + build + .env + start
      reset-sandbox.sh        # Destroy/recreate sandbox

cron.json                     # Cron job definitions (hot-reloaded)
package.json                  # Dependencies + scripts
tsconfig.json                 # TypeScript config
vitest.config.ts             # Test configuration
.env.example                  # Environment template
```

## Key Technical Details

### Session Management
- Sessions use structured IDs: `tg-{chatId}-{timestamp}`
- First message auto-creates a session (no `/new` needed)
- Infinite sessions enabled for long-running conversations (auto-compaction at 80% context)
- Per-chat mutex prevents concurrent session creation races
- Sessions persist across restarts via CopilotClient SDK
- Optional idle cleanup for non-cron sessions via `SESSION_IDLE_TIMEOUT_MINUTES`

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

## What You Can Build

This repo is just one example. The same extensibility model enables:

**Extension Mode** (`.mjs` files):
- GitHub webhook processors
- Code review automation  
- Custom integrations with tools
- Personal productivity scripts

**Service Mode** (`CopilotClient`):
- Multi-user chat bots
- Workflow orchestration services
- API gateways with AI reasoning
- Custom agent platforms

**Cloud Mode** (OpenShell + Terraform):
- Production chat bots
- Serverless AI functions
- Enterprise integrations
- Secure multi-tenant services

The GitHub Copilot CLI extensibility model scales with your needs — start simple, grow sophisticated.

## License

MIT
