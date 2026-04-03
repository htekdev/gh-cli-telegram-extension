# Telegram ↔ GitHub Copilot CLI Bridge

A Copilot CLI extension that bridges Telegram messages with your active Copilot CLI session. Chat with Copilot from your phone via Telegram.

## How It Works

```
┌──────────────┐    long polling     ┌──────────────┐    session.send()    ┌──────────────┐
│   Telegram   │ ◄─────────────────► │   Extension  │ ◄──────────────────► │  Copilot CLI │
│   (your phone)│   getUpdates       │  (bridge)    │   assistant.message  │  (session)   │
└──────────────┘   sendMessage       └──────────────┘                      └──────────────┘
```

1. **Telegram → Copilot**: The extension long-polls Telegram's `getUpdates` API (with `timeout=25`). Telegram holds the connection open and returns **instantly** when a new message arrives. The message is injected into the Copilot CLI session as a user prompt.

2. **Copilot → Telegram**: The extension listens for `assistant.message` events. When the agent responds, the response is forwarded to Telegram via `sendMessage`.

3. **Typing indicator**: While the agent is processing, a typing indicator is shown in the Telegram chat.

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456789:ABCdefGHI...`)

### 2. Configure the Extension

```bash
cp .env.example .env
```

Edit `.env` and paste your bot token:

```env
TELEGRAM_BOT_TOKEN=your-bot-token-here
TELEGRAM_CHAT_ID=
```

### 3. Get Your Chat ID (Optional but Recommended)

Setting `TELEGRAM_CHAT_ID` locks the bridge to your specific chat for security:

1. Start a Copilot CLI session in this repo
2. Open Telegram and send `/start` to your bot
3. The bot will reply with your chat ID
4. Add it to `.env`: `TELEGRAM_CHAT_ID=123456789`
5. Reload extensions (type `/clear` in Copilot CLI)

### 4. Install as a User Extension (Optional)

To use across all repos, copy the extension to your user extensions directory:

```bash
# Find your Copilot config directory (shown in `ghcs --help` or similar)
cp -r .github/extensions/telegram-bridge ~/.copilot/extensions/
```

## Usage

Once configured, the bridge starts automatically when a Copilot CLI session begins in this repo.

### From Telegram

- Send any text message → becomes a Copilot CLI prompt
- `/start` — shows welcome message and your chat ID
- `/status` — shows bridge connection status
- `/help` — shows available commands

### From Copilot CLI

The agent has access to these tools:

- `telegram_send_message` — send an explicit message to Telegram
- `telegram_get_status` — check bridge connection status

All assistant responses are automatically forwarded to Telegram.

## Architecture

- **Long Polling** (not webhooks) — no public URL needed, works behind NAT/firewalls
- **`timeout=25`** on `getUpdates` — near-instant message delivery, Telegram holds the HTTP connection open
- **Offset tracking** — skips old messages on startup, processes only new ones
- **Typing indicators** — refreshed every 4s while the agent is processing
- **Message chunking** — responses over 4096 chars are split automatically
- **Chat locking** — optional `TELEGRAM_CHAT_ID` restricts access to a single chat

## Limitations

- Text messages only (photos, documents, voice, etc. are not forwarded)
- No Markdown formatting in Telegram (sent as plain text)
- State is lost on `/clear` (extension reloads, but reconnects automatically)
