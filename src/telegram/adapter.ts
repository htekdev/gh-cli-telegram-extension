import type { MessagingChannel } from "../channels/types.js";
import type { Config } from "../config.js";
import { TelegramApi } from "./api.js";
import { SessionManager } from "../sessions/manager.js";
import { CommandHandler } from "./commands.js";
import { MessageRouter } from "./router.js";
import { TelegramPoller } from "./poller.js";

/** Telegram channel adapter that bridges to Copilot sessions. */
export class TelegramAdapter implements MessagingChannel {
  readonly name = "telegram";
  private readonly api: TelegramApi;
  private readonly poller: TelegramPoller;
  readonly sessionManager: SessionManager;

  constructor(config: Config) {
    this.api = new TelegramApi(config.telegramBotToken!);
    this.sessionManager = new SessionManager(config, this);
    const commands = new CommandHandler(this.sessionManager, this.api);
    const router = new MessageRouter(this.sessionManager, this.api);
    this.poller = new TelegramPoller({
      telegram: this.api,
      commands,
      router,
      chatId: config.telegramChatId,
    });
  }

  /** Send a message to Telegram. */
  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.api.sendMessage(chatId, text);
  }

  /** Send a typing indicator to Telegram. */
  async sendTypingAction(chatId: string): Promise<void> {
    await this.api.sendTypingAction(chatId);
  }

  /** Start the Telegram poller and session manager. */
  async start(): Promise<void> {
    await this.sessionManager.start();
    await this.poller.start();
  }

  /** Stop the Telegram poller. */
  stop(): void {
    this.poller.stop();
  }
}
