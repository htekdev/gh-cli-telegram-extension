/**
 * Telegram Bridge Extension for GitHub Copilot CLI
 *
 * Bridges Telegram messages ↔ Copilot CLI sessions using long polling.
 * - Telegram messages become user prompts in the session.
 * - Assistant responses are forwarded back to Telegram.
 *
 * Requires TELEGRAM_BOT_TOKEN in .env at the project root.
 * Optionally set TELEGRAM_CHAT_ID to restrict to a single chat.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Configuration — read from .env
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
let TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "TELEGRAM_BOT_TOKEN" && !TELEGRAM_TOKEN) TELEGRAM_TOKEN = value;
    if (key === "TELEGRAM_CHAT_ID" && !TELEGRAM_CHAT_ID) TELEGRAM_CHAT_ID = value;
  }
}

parseEnvFile(ENV_FILE);

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------
const API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

async function telegramApi(method, body = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

const TELEGRAM_MAX_LENGTH = 4096;

async function sendTelegramMessage(chatId, text) {
  if (!text || text.trim().length === 0) return;
  const chunks = [];
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
  }
  for (const chunk of chunks) {
    await telegramApi("sendMessage", { chat_id: chatId, text: chunk });
    if (chunks.length > 1) await sleep(150);
  }
}

async function sendTypingAction(chatId) {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* best-effort */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Long-polling loop
// ---------------------------------------------------------------------------
let running = false;
let pollOffset = 0;
let activeChatId = TELEGRAM_CHAT_ID || null;
let pollController = null;
let typingInterval = null;

async function skipOldUpdates() {
  try {
    const result = await telegramApi("getUpdates", {
      offset: -1,
      limit: 1,
      timeout: 0,
    });
    if (result.length > 0) {
      pollOffset = result[0].update_id + 1;
    }
  } catch {
    /* start from 0 */
  }
}

function startTypingIndicator(chatId) {
  stopTypingIndicator();
  sendTypingAction(chatId);
  typingInterval = setInterval(() => sendTypingAction(chatId), 4000);
}

function stopTypingIndicator() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

// Ensure polling stops immediately when the process is killed.
// On Windows, SIGTERM doesn't fire Node.js handlers — the CLI communicates
// over stdio (JSON-RPC), so when the parent disconnects, stdin closes.
function cleanup() {
  running = false;
  stopTypingIndicator();
  if (pollController) pollController.abort();
}

process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("disconnect", cleanup);
process.stdin.on("close", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

async function pollLoop(session) {
  running = true;

  // Wait briefly for any previous instance's getUpdates to finish dying.
  // Telegram only allows one getUpdates consumer per bot token.
  await sleep(2000);

  await skipOldUpdates();

  try {
    const me = await telegramApi("getMe");
    await session.log(
      `🤖 Telegram bot connected: @${me.username} (${me.first_name})`
    );
  } catch (err) {
    await session.log(`⚠️ Could not verify bot identity: ${err.message}`, {
      level: "warning",
    });
  }

  await session.log("📡 Telegram long polling started — waiting for messages");

  while (running) {
    try {
      pollController = new AbortController();

      const res = await fetch(`${API_BASE}/getUpdates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: pollOffset,
          timeout: 10,
          allowed_updates: ["message"],
        }),
        signal: pollController.signal,
      });

      const data = await res.json();

      if (!data.ok) {
        const isConflict = data.description?.includes("Conflict");
        if (isConflict) {
          // Another instance is still polling — back off and retry
          await session.log(
            "⏳ Waiting for previous polling instance to release...",
            { ephemeral: true }
          );
          await sleep(3000);
          continue;
        }
        await session.log(
          `⚠️ Telegram API error: ${data.description}`,
          { level: "warning" }
        );
        await sleep(5000);
        continue;
      }

      for (const update of data.result) {
        pollOffset = update.update_id + 1;

        if (!update.message) continue;

        const msg = update.message;
        const chatId = String(msg.chat.id);
        const from =
          msg.from?.first_name || msg.from?.username || "Unknown";

        // Security: if TELEGRAM_CHAT_ID is set, only accept from that chat
        if (TELEGRAM_CHAT_ID && chatId !== TELEGRAM_CHAT_ID) {
          await sendTelegramMessage(
            chatId,
            "⛔ Unauthorized. This bot is locked to a specific chat."
          );
          continue;
        }

        activeChatId = chatId;

        // Handle bot commands
        if (msg.text === "/start") {
          await sendTelegramMessage(
            chatId,
            `✅ Connected! Your chat ID is: ${chatId}\n\n` +
              `Send any message and it will be forwarded to your GitHub Copilot CLI session.\n\n` +
              `Commands:\n/status — check bridge status\n/help — show this message`
          );
          continue;
        }

        if (msg.text === "/status") {
          await sendTelegramMessage(
            chatId,
            `📡 Bridge Status\n` +
              `• Polling: ${running ? "active" : "stopped"}\n` +
              `• Chat ID: ${chatId}\n` +
              `• Offset: ${pollOffset}`
          );
          continue;
        }

        if (msg.text === "/help") {
          await sendTelegramMessage(
            chatId,
            `🤖 Telegram ↔ Copilot CLI Bridge\n\n` +
              `Send any text message and it will be forwarded to your active Copilot CLI session as a user prompt.\n\n` +
              `The assistant's response will be sent back here automatically.\n\n` +
              `Commands:\n/start — welcome message & chat ID\n/status — bridge status\n/help — this message`
          );
          continue;
        }

        // Forward text messages to the session
        if (msg.text) {
          const preview =
            msg.text.length > 80
              ? msg.text.slice(0, 80) + "…"
              : msg.text;
          await session.log(`💬 [Telegram] ${from}: ${preview}`);

          startTypingIndicator(chatId);

          // Fire-and-forget with setTimeout to avoid blocking the poll loop.
          // sendAndWait would block until the agent finishes, starving polling.
          setTimeout(() => {
            session.send({ prompt: msg.text }).catch((err) => {
              session.log(
                `⚠️ Failed to inject prompt: ${err.message}`,
                { level: "warning" }
              );
            });
          }, 0);
          continue;
        }

        // Non-text messages — notify user
        if (msg.photo || msg.document || msg.video || msg.voice || msg.sticker) {
          await sendTelegramMessage(
            chatId,
            "📎 Only text messages are supported right now. Please send text."
          );
        }
      }
    } catch (err) {
      if (err.name === "AbortError") break;
      await session.log(
        `⚠️ Polling error: ${err.message}`,
        { level: "warning" }
      );
      await sleep(3000);
    }
  }
}

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (!TELEGRAM_TOKEN) {
        await session.log(
          "⚠️ TELEGRAM_BOT_TOKEN not found in .env — Telegram bridge disabled",
          { level: "warning" }
        );
        return {
          additionalContext:
            "[telegram-bridge] Telegram bridge is NOT active. " +
            "The user needs to set TELEGRAM_BOT_TOKEN in .env and reload extensions.",
        };
      }

      // Start polling in the background (non-blocking)
      pollLoop(session).catch(async (err) => {
        await session.log(
          `❌ Telegram polling crashed: ${err.message}`,
          { level: "error" }
        );
      });

      const chatInfo = TELEGRAM_CHAT_ID
        ? ` (locked to chat ${TELEGRAM_CHAT_ID})`
        : " (accepting all chats)";
      return {
        additionalContext:
          `[telegram-bridge] Telegram bridge is ACTIVE${chatInfo}. ` +
          `Incoming Telegram messages will appear as user prompts. ` +
          `All your responses are automatically forwarded to Telegram. ` +
          `You also have a 'telegram_send_message' tool for explicit sends.`,
      };
    },

    onSessionEnd: async () => {
      stopTypingIndicator();
      // Polling intentionally stays alive — the bridge persists
      // until the CLI process itself exits.
    },
  },

  tools: [
    {
      name: "telegram_send_message",
      description:
        "Send an explicit message to the connected Telegram chat. " +
        "Use for status updates, formatted content, or when you need to " +
        "send something outside the normal response flow.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message text to send to Telegram",
          },
          chat_id: {
            type: "string",
            description:
              "Optional: specific chat ID to send to. Defaults to the active chat.",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const targetChat = args.chat_id || activeChatId;
        if (!targetChat) {
          return {
            textResultForLlm:
              "No active Telegram chat. A user must message the bot first, or set TELEGRAM_CHAT_ID in .env.",
            resultType: "failure",
          };
        }
        if (!TELEGRAM_TOKEN) {
          return {
            textResultForLlm:
              "Telegram bridge is not configured. Set TELEGRAM_BOT_TOKEN in .env.",
            resultType: "failure",
          };
        }
        try {
          await sendTelegramMessage(targetChat, args.message);
          return `Message sent to Telegram chat ${targetChat}`;
        } catch (err) {
          return {
            textResultForLlm: `Failed to send: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },
    {
      name: "telegram_get_status",
      description:
        "Check the current status of the Telegram bridge connection.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return JSON.stringify(
          {
            configured: !!TELEGRAM_TOKEN,
            polling: running,
            activeChatId: activeChatId || "none",
            chatIdFromEnv: TELEGRAM_CHAT_ID || "not set",
            pollOffset,
          },
          null,
          2
        );
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Forward assistant responses → Telegram
// ---------------------------------------------------------------------------
session.on("assistant.message", async (event) => {
  if (!activeChatId || !TELEGRAM_TOKEN || !running) return;

  stopTypingIndicator();

  const content = event.data.content;
  if (!content || content.trim().length === 0) return;

  try {
    await sendTelegramMessage(activeChatId, content);
  } catch (err) {
    await session.log(
      `⚠️ Failed to forward response to Telegram: ${err.message}`,
      { level: "warning" }
    );
  }
});

// Stop typing when session goes idle (fallback)
session.on("session.idle", () => {
  stopTypingIndicator();
});
