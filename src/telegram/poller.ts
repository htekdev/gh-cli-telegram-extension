import type { TelegramApi, TelegramUpdate } from "./api.js";
import { sleepMs } from "./api.js";
import type { CommandHandler } from "./commands.js";
import type { MessageRouter } from "./router.js";

/** Constructor options for TelegramPoller. */
export interface PollerOptions {
  telegram: TelegramApi;
  commands: CommandHandler;
  router: MessageRouter;
  chatId?: string;
}

/** Long-polling loop for Telegram updates. */
export class TelegramPoller {
  private readonly telegram: TelegramApi;
  private readonly commands: CommandHandler;
  private readonly router: MessageRouter;
  private readonly chatId?: string;
  private running = false;
  private pollOffset = 0;
  private abortController: AbortController | null = null;

  constructor(opts: PollerOptions) {
    this.telegram = opts.telegram;
    this.commands = opts.commands;
    this.router = opts.router;
    this.chatId = opts.chatId;
  }

  /** Start polling for Telegram updates. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Brief delay for any previous instance's getUpdates to finish
    await sleepMs(2000);

    // Skip old updates
    await this.skipOldUpdates();

    try {
      const me = await this.telegram.getMe();
      console.log(`[poller] 🤖 Telegram bot connected: @${me.username} (${me.first_name})`);
    } catch (err) {
      console.warn(`[poller] ⚠️ Could not verify bot identity:`, err);
    }

    console.log("[poller] 📡 Telegram long polling started");

    while (this.running) {
      try {
        this.abortController = new AbortController();
        const data = await this.telegram.getUpdates(
          this.pollOffset,
          10,
          this.abortController.signal,
        );

        if (!data.ok) {
          const isConflict = data.description?.includes("Conflict");
          if (isConflict) {
            console.log("[poller] ⏳ Waiting for previous polling instance...");
            await sleepMs(3000);
            continue;
          }
          console.warn(`[poller] ⚠️ Telegram API error: ${data.description}`);
          await sleepMs(5000);
          continue;
        }

        for (const update of data.result) {
          await this.handleUpdate(update);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") break;
        console.warn("[poller] ⚠️ Polling error:", err);
        await sleepMs(3000);
      }
    }

    console.log("[poller] Polling stopped");
  }

  /** Stop the polling loop. */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  /** Report whether the poller is running. */
  isRunning(): boolean {
    return this.running;
  }

  private async skipOldUpdates(): Promise<void> {
    try {
      const data = await this.telegram.getUpdates(-1, 0);
      if (data.ok && data.result.length > 0) {
        this.pollOffset = data.result[data.result.length - 1].update_id + 1;
      }
    } catch (err) {
      console.warn("[poller] Could not skip old updates, starting from offset 0:", err);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    this.pollOffset = update.update_id + 1;

    if (!update.message) return;
    const msg = update.message;
    const chatId = String(msg.chat.id);

    // Security: restrict to configured chat ID
    if (this.chatId && chatId !== this.chatId) {
      await this.telegram.sendMessage(
        chatId,
        "⛔ Unauthorized. This bot is locked to a specific chat.",
      );
      return;
    }

    try {
      // Handle commands first
      if (msg.text && this.commands.isCommand(msg.text)) {
        const handled = await this.commands.handle(msg);
        if (handled) return;
      }

      // Route text messages
      if (msg.text) {
        await this.router.routeTextMessage(msg);
        return;
      }

      // Route photos
      if (msg.photo) {
        await this.router.routePhotoMessage(msg);
        return;
      }

      // Unsupported media
      if (msg.document || msg.video || msg.voice || msg.sticker) {
        await this.telegram.sendMessage(
          chatId,
          "📎 Only text and photo messages are supported right now.",
        );
      }
    } catch (err) {
      console.error(`[poller] Error handling update ${update.update_id}:`, err);
      try {
        await this.telegram.sendMessage(chatId, "⚠️ Something went wrong processing that message. Please try again.");
      } catch {
        /* best-effort error reply */
      }
    }
  }
}
