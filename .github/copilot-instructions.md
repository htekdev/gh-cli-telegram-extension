# Copilot Instructions — Copilot Telegram Bridge

## Project Overview

Multi-channel bridge service connecting Telegram and Slack to GitHub Copilot CLI sessions via the `@github/copilot-sdk`. Each messaging platform runs as a pluggable adapter with its own `SessionManager` managing Copilot session lifecycles.

## Architecture

```
index.ts (entry)
├── TelegramAdapter (MessagingChannel)
│   ├── TelegramPoller → long polling with backoff
│   ├── CommandHandler → /start, /new, /switch, /list, /end, /status, /help
│   ├── MessageRouter → text/photo → session
│   └── SessionManager → CopilotClient ↔ Copilot CLI
├── SlackAdapter (MessagingChannel)
│   ├── SlackClient → Socket Mode + Web API
│   ├── SlackThreadRouter → each thread = one session
│   ├── SlackCommandHandler → slash commands
│   └── SessionManager → CopilotClient ↔ Copilot CLI
└── CronScheduler
    └── cron.json → hot-reload, sendToCronSession()
```

### Key Abstractions

- **`MessagingChannel`** (`channels/types.ts`) — Interface all adapters implement: `sendMessage()`, `sendTypingAction()`, `start()`, `stop()`.
- **`SessionManager`** (`sessions/manager.ts`) — Core state machine. One per channel. Manages `CopilotClient` lifecycle, per-chat session tracking, typing indicators, and per-chat mutex locks.
- **`Config`** (`config.ts`) — Zod-validated runtime config from `.env` + env vars. Includes MCP server configs loaded from JSON files.

### Session IDs

- User sessions: `tg-{chatId}-{timestamp}`
- Cron sessions: `cron-{jobId}` (predictable, reusable)
- Slack sessions: `slack-{channel}-{thread_ts}`

### MCP Server Configuration

Sessions receive MCP tool configs via `mcpServers` on `createSession()`/`resumeSession()`. Resolution priority:

1. `MCP_CONFIG_PATH` env var (explicit path)
2. `./mcp-servers.json` (project-local)
3. `~/.copilot/mcp-config.json` (native Copilot config)

Supports both `{ "mcpServers": { ... } }` wrapper and flat format.

## TypeScript & Module System

- **ESM** — `"type": "module"` in package.json. Always use `.js` extensions in relative imports.
- **Target**: ES2022, `"module": "Node16"`, `"moduleResolution": "Node16"`
- **Strict mode**: All strict flags enabled (`noImplicitAny`, `strictNullChecks`, etc.)
- **No DOM** — `"lib": ["ES2022"]`, pure Node.js
- Native `fetch()` — no external HTTP client for Telegram API

```typescript
// ✅ Correct import
import { SessionManager } from "../sessions/manager.js";

// ❌ Wrong — missing .js extension
import { SessionManager } from "../sessions/manager";
```

## Naming Conventions

- **Files**: `camelCase.ts` (e.g., `manager.ts`, `adapter.ts`, `thread-router.ts`)
- **Test files**: `*.test.ts` colocated with source (e.g., `config.test.ts`)
- **Type-only files**: `types.ts` in each module directory
- **Classes**: PascalCase (`SessionManager`, `TelegramApi`, `CronScheduler`)
- **Functions**: camelCase (`loadConfig`, `loadMcpServers`, `cronMatches`)
- **Constants**: UPPER_SNAKE_CASE (`TELEGRAM_MAX_LENGTH`, `CROSS_SESSION_CONTEXT`)
- **Session IDs**: kebab-prefixed (`tg-`, `cron-`, `slack-`)

## Error Handling Patterns

### Try-catch with logging and user notification

```typescript
try {
  await this.sessionManager.sendMessage(chatId, prompt);
} catch (err) {
  console.error("[router] Failed:", err);
  try {
    await telegram.sendMessage(chatId, "⚠️ Something went wrong. Please try again.");
  } catch (notifyErr) {
    console.warn("[router] Notification failed:", notifyErr);
  }
}
```

### Fire-and-forget with `.catch()` for non-critical operations

```typescript
this.channel.sendTypingAction(chatId).catch((err) => {
  console.warn("[session-manager] Typing action failed:", err);
});
```

### Zod for config validation

```typescript
const parsed = configSchema.parse(raw); // Throws ZodError if invalid
```

### Always clean up on failure — use `finally` blocks for state cleanup

```typescript
try {
  await session.disconnect();
} catch (disconnectErr) {
  console.warn(`[session-manager] Error disconnecting:`, disconnectErr);
} finally {
  this.sessionMap.delete(sessionId);
  this.attachedSessions.delete(sessionId);
}
```

## Concurrency Pattern — Per-Chat Mutex

The `SessionManager` uses a promise-based lock to prevent concurrent session creation per chat:

```typescript
const prevLock = this.sendLocks.get(chatId) ?? Promise.resolve();
let releaseLock: () => void;
const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve; });
this.sendLocks.set(chatId, lockPromise);
await prevLock;
try { /* work */ } finally { releaseLock!(); }
```

Always use this pattern when adding new operations that could race with session creation.

## Logging Convention

All log messages use `[module-name]` prefix with emoji indicators:

```typescript
console.log("[config] Configuration loaded");
console.log("[session-manager] Created session tg-123-1704067200000");
console.log("[telegram] 🤖 Telegram poller started");
console.warn("[poller] ⚠️ Telegram API conflict, backing off");
console.error("[bridge] ❌ Error stopping:", err);
```

## Testing

### Framework & Commands

- **Vitest** with `vitest.config.ts`
- Tests colocated: `src/**/*.test.ts`

```bash
npm test              # vitest run (single pass)
npm run test:watch    # vitest (watch mode)
npm run test:coverage # vitest run --coverage
```

### Coverage Thresholds (enforced)

- Statements: 80%, Branches: 75%, Functions: 80%, Lines: 80%
- `src/index.ts` excluded from coverage (entry point bootstrapping)

### Test Patterns

- Use `vi.mock()` for module-level mocks (e.g., `@github/copilot-sdk`, `node:os`)
- Use `vi.fn()` for per-test spies
- Use temp directories (`tmpdir()`) for filesystem tests — clean up in `afterEach`
- Clear env vars in `beforeEach` to prevent cross-test contamination
- Mock `CopilotClient` with a `MockSession` class that supports `on()`, `emit()`, `send()`, `disconnect()`

### Writing Tests for New Features

Every source change must have corresponding tests. When adding:

- **New config fields** — test loading from `.env`, from env vars, defaults, validation errors
- **New SessionManager methods** — test all code paths (create, resume, resume-fallback-to-create, switchSession)
- **New commands** — test routing, success, and error paths
- **New adapters** — test the `MessagingChannel` interface contract

## Build

```bash
npm run build   # tsc → dist/
npm start       # node dist/index.js
npm run dev     # tsc --watch & node --watch dist/index.js
```

Output goes to `dist/` with declarations (`.d.ts`) and source maps.

## Adding a Telegram Command

1. Add a case to `telegram/commands.ts` → `handle()` switch
2. Implement `handleMyCommand(chatId, args)` with try/catch + user feedback
3. Add tests in `telegram/commands.test.ts`
4. Update the `/help` response text

## Adding a Cron Job

Edit `cron.json` (hot-reloaded via file watcher):

```json
{
  "id": "my-job",
  "schedule": "0 9 * * 1-5",
  "prompt": "Your prompt here",
  "enabled": true,
  "channel": "telegram"
}
```

Cron sessions run in isolated `cron-{jobId}` sessions — they never switch the user's active session.

## Infrastructure & Deployment

- **Terraform** in `infra/aws/` — EC2 + OpenShell sandbox
- **Commit-pinned deploys** — `TF_VAR_git_ref` = `GITHUB_SHA`
- **GitHub Actions** (`.github/workflows/deploy.yml`) — PR → dev, merge to main → prod
- **OpenShell sandbox** — default-deny networking, credential injection via providers
- **MCP config** generated at `~/.copilot/mcp-config.json` by `sandbox-setup.sh`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | One channel required | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | No | Restrict to specific chat |
| `SLACK_BOT_TOKEN` | One channel required | Slack bot token (xoxb-...) |
| `SLACK_APP_TOKEN` | With Slack | Slack app-level token (xapp-...) |
| `SLACK_CHANNEL_ID` | No | Restrict to specific channel |
| `CLI_URL` | No | Connect to existing Copilot CLI server |
| `CLI_PORT` | No | Port for CLI server connection |
| `CRON_ENABLED` | No | Enable cron scheduler (default: false) |
| `MCP_CONFIG_PATH` | No | Path to MCP server config JSON |
| `LOG_LEVEL` | No | debug, info, warn, error (default: info) |

## Gotchas

- **Telegram poller conflict**: Only one poller per bot token. Multiple instances → 409 Conflict → 3s backoff.
- **ESM imports**: Always use `.js` extension in relative imports even though source is `.ts`.
- **Session event handlers**: Use `attachedSessions` Set to prevent double-attaching handlers on resume.
- **Infinite sessions**: Enabled by default with 80% background compaction / 95% buffer exhaustion thresholds.
- **Slack chat IDs**: Format is `{channel}:{thread_ts}`, not just channel ID.
- **Config changes require restart**: MCP servers and env config are loaded once at startup.
