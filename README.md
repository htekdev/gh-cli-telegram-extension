# 🤖 Telegram ↔ GitHub Copilot CLI Bridge

**Who needs OpenClaw when you have GitHub Copilot CLI Extensions?**

[OpenClaw](https://github.com/openclaw/openclaw) is a fantastic project — a full personal AI assistant framework with a gateway daemon, 20+ channel integrations (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, IRC, Matrix...), companion apps, voice wake words, a live canvas, multi-agent routing, onboarding wizards, and thousands of lines of infrastructure code.

**This project does the same core thing in a single file.**

One `.mjs` extension. ~420 lines. No gateway. No daemon. No infrastructure. Just a Copilot CLI extension that bridges Telegram to your active session using the Telegram Bot API's long polling. That's it.

The point isn't that OpenClaw is bad — it's that GitHub Copilot CLI's extension system is **so powerful** that you can replicate the core value proposition (chat with an AI agent from your phone while it has full access to your codebase) without any of the framework overhead. The SDK gives you `session.send()` to inject prompts, `session.on("assistant.message")` to capture responses, and a full Node.js runtime. That's all you need.

Want Slack instead of Telegram? Write another extension. Discord? Same pattern. The extension system **is** the framework.

## The Idea

What if you could text your AI coding assistant from your phone while walking the dog, lying in bed, or sitting in a meeting? Not some watered-down chatbot — the **real** Copilot CLI with full access to your codebase, terminal, git, GitHub APIs, and every tool in the toolkit.

That's exactly what this extension does.

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

### Real Examples From Our First Session

From Telegram, we asked Copilot to:
- ✅ Check what we've been working on across repos (queried session history)
- ✅ List all open PRs across GitHub (ran `gh search prs`)
- ✅ Get detailed PR status with repo breakdowns

All from a phone. All with full context.

## The Build Story

This extension was built **live in a single session** — iteratively, with real-time debugging. Here's the narrative:

### 1. Research & Scaffold
We started by researching the Telegram Bot API. Two options exist for receiving messages: **webhooks** (requires a public URL) and **long polling** (pure HTTP, works behind NAT). For a CLI tool, long polling was the obvious choice — Telegram holds the HTTP connection open and returns **instantly** when a message arrives. Near real-time, zero infrastructure.

### 2. First Working Version
Built the extension using the Copilot CLI SDK (`@github/copilot-sdk/extension`):
- `joinSession()` to connect to the active CLI session
- `session.send()` to inject Telegram messages as user prompts
- `session.on("assistant.message")` to capture responses and forward them back
- Telegram `getUpdates` with `timeout=10` for long polling

### 3. The Conflict Problem
When extensions reload (`/clear` or code changes), the CLI kills the old process and starts a new one. But Telegram only allows **one** `getUpdates` consumer per bot token. The old HTTP request was still hanging when the new instance started polling → `"Conflict: terminated by other getUpdates request"`.

**The fixes evolved through several iterations:**
- Added process signal handlers (SIGTERM/SIGINT) — but these don't fire on Windows
- Added `stdin.close` listener — since extensions communicate over stdio JSON-RPC, stdin closing means the parent disconnected
- Added conflict detection with backoff — if we get a conflict error, wait 3s and retry silently
- Added a 2s startup delay — gives old instances time to die
- Reduced poll timeout from 25s to 10s — old connections release faster

### 4. The Duplicate Polling Bug
`onSessionStart` fires on every session transition — not just the first one. Each fire spawned a new polling loop, creating multiple consumers fighting over `getUpdates`.

**Fix:** Moved polling out of `onSessionStart` entirely. It now starts immediately when the script loads, right after `joinSession()`. One script execution = one poll loop. Clean.

### 5. The Prompt Format Fix
Messages from Telegram were arriving as raw text ("Hello?") with no indication they came from Telegram. The agent had no context about the message source.

**Fix:** Prefixed all forwarded messages: `[Telegram from Hector]: Hello?`

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Update method | Long polling | No public URL needed, works behind NAT/firewalls, near-instant delivery |
| Poll timeout | 10 seconds | Balance between responsiveness and fast instance transitions on reload |
| Prompt injection | `setTimeout(() => session.send(), 0)` | Non-blocking — doesn't starve the poll loop |
| Polling lifecycle | Start on script load | Avoids duplicate polling from repeated `onSessionStart` calls |
| Message chunking | Auto-split at 4096 chars | Telegram's max message length |
| Chat security | Optional `TELEGRAM_CHAT_ID` lock | Restrict bot to a single authorized chat |

## Setup

### 1. Create a Telegram Bot
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts
3. Copy the bot token

### 2. Configure
```bash
cp .env.example .env
# Edit .env and paste your bot token:
# TELEGRAM_BOT_TOKEN=your-token-here
```

### 3. Start a Copilot CLI Session
Open a terminal in this repo and start Copilot CLI. The extension loads automatically.

### 4. Connect From Telegram
Send `/start` to your bot. That's it — you're connected.

### 5. Lock to Your Chat (Recommended)
The `/start` response shows your chat ID. Add it to `.env`:
```
TELEGRAM_CHAT_ID=123456789
```

## File Structure

```
.github/extensions/telegram-bridge/
  extension.mjs          ← The entire bridge (single file, ~420 lines)
.env                     ← Your bot token (gitignored)
.env.example             ← Template
```

## The Point

This isn't just a Telegram bot. It's a proof of concept that **GitHub Copilot CLI extensions are a legitimate platform for building agent interfaces**.

### OpenClaw vs. This Extension

| | OpenClaw | This Extension |
|---|---------|----------------|
| **Setup** | `npm install -g openclaw`, onboarding wizard, gateway daemon, systemd/launchd service | Drop one `.mjs` file, add bot token to `.env` |
| **Infrastructure** | Gateway server, WebSocket control plane, session model, media pipeline | Nothing. The CLI *is* the infrastructure |
| **Channels** | 20+ (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, IRC...) | 1 (Telegram). But adding another is just another extension file |
| **Agent runtime** | Custom Pi agent runtime with RPC, tool streaming, block streaming | GitHub Copilot — already the best coding agent on the planet |
| **Code access** | Configured per-workspace, sandboxed | Full access to everything the CLI session has |
| **Tools** | Custom skill system, managed skills, workspace skills | Every tool in the Copilot CLI ecosystem + MCP servers + custom extension tools |
| **Lines of code** | Thousands across gateway, channels, agent, CLI | ~420 lines, one file |
| **Dependencies** | Node.js, pnpm/bun, systemd/launchd, model API keys | Node.js (already there for Copilot CLI) |

The trade-off is obvious: OpenClaw is a **product** — polished, multi-channel, multi-user, always-on. This extension is a **hack** — single-channel, single-user, runs while your terminal is open. But for the use case of "I want to talk to my coding agent from my phone," the hack wins on simplicity by a mile.

### The SDK primitives that make this possible

- **`session.send()`** — inject prompts programmatically
- **`session.on("assistant.message")`** — capture agent responses in real-time
- **Custom tools** — register new tools the agent can use (`telegram_send_message`)
- **Lifecycle hooks** — react to session start, end, errors
- **Full Node.js runtime** — `fetch`, `fs`, timers, whatever you need

With these primitives, you can bridge Copilot CLI to **anything**: Slack, Discord, SMS, a web dashboard, a voice assistant, a hardware button. The extension system is the universal adapter. Each channel is just another `.mjs` file.

**Who needs a framework when you have primitives this good?**

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message + your chat ID |
| `/status` | Bridge connection status |
| `/help` | Available commands |

## Limitations

- Text messages only (photos, documents, voice not forwarded yet)
- One bot token = one polling consumer (Telegram API constraint)
- State resets on extension reload (chat ID re-links on first message)

## License

MIT
