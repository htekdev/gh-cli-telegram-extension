import type { MessagingChannel } from "../channels/types.js";
import type { Config } from "../config.js";
import { SlackClient } from "./client.js";
import { SlackThreadRouter } from "./thread-router.js";
import { SlackCommandHandler } from "./commands.js";
import { SessionManager } from "../sessions/manager.js";

type SlackMessageEvent = {
  channel?: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  ts?: string;
  bot_id?: string;
  subtype?: string;
};

type SlackSlashCommandPayload = {
  command?: string;
  channel_id?: string;
  thread_ts?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSlackMessageEvent = (value: unknown): value is SlackMessageEvent => {
  if (!isRecord(value)) return false;
  return typeof value["channel"] === "string";
};

const isSlackSlashCommandPayload = (value: unknown): value is SlackSlashCommandPayload => {
  if (!isRecord(value)) return false;
  return typeof value["command"] === "string" && typeof value["channel_id"] === "string";
};

/** Slack channel adapter that bridges to Copilot sessions. */
export class SlackAdapter implements MessagingChannel {
  readonly name = "slack";
  private readonly client: SlackClient;
  private readonly threadRouter: SlackThreadRouter;
  private readonly commands: SlackCommandHandler;
  readonly sessionManager: SessionManager;
  private readonly channelFilter?: string;

  constructor(config: Config) {
    this.client = new SlackClient(config.slackAppToken!, config.slackBotToken!);
    this.sessionManager = new SessionManager(config, this);
    this.threadRouter = new SlackThreadRouter(this.sessionManager, this.client);
    this.commands = new SlackCommandHandler(
      this.client,
      this.threadRouter,
      this.sessionManager,
    );
    this.channelFilter = config.slackChannelId;
  }

  /** Send a message to Slack (optionally in a thread). */
  async sendMessage(chatId: string, text: string): Promise<void> {
    // chatId is "channel:threadTs" or "channel:default"
    const [channel, threadTs] = chatId.split(":");
    const ts = threadTs === "default" ? undefined : threadTs;
    await this.client.sendMessage(channel, text, ts);
  }

  /** Slack has no bot typing indicator, so this is a no-op. */
  async sendTypingAction(_chatId: string): Promise<void> {}

  /** Start the Slack socket listener and session manager. */
  async start(): Promise<void> {
    await this.sessionManager.start();

    const socketMode = this.client.getSocketMode();

    // Handle regular messages
    socketMode.on("message", async ({ event, ack }) => {
      try {
        await ack();
      } catch (ackErr) {
        console.warn("[slack] Failed to ack message:", ackErr);
      }

      if (!isSlackMessageEvent(event)) return;

      const botId = typeof event.bot_id === "string" ? event.bot_id : undefined;
      const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
      // Skip bot messages and system messages (channel_join, channel_leave, etc.)
      // Regular user messages have no subtype; any subtype indicates a system event
      if (botId || subtype) return;

      const channel = event.channel ?? "";
      if (!channel) return;
      const text = typeof event.text === "string" ? event.text : "";
      const user = typeof event.user === "string" ? event.user : "Unknown";
      const threadTs =
        typeof event.thread_ts === "string"
          ? event.thread_ts
          : typeof event.ts === "string"
            ? event.ts
            : undefined;

      // Channel filter
      if (this.channelFilter && channel !== this.channelFilter) return;

      try {
        // Check for message-based commands
        if (this.commands.isCommand(text)) {
          const handled = await this.commands.handle(channel, text, threadTs);
          if (handled) return;
        }

        // Route to session via thread router
        await this.threadRouter.routeMessage(channel, text, user, threadTs);
      } catch (err) {
        console.error("[slack] Error handling message:", err);
        try {
          await this.client.sendMessage(channel, "⚠️ Something went wrong processing that message. Please try again.", threadTs);
        } catch { /* best-effort error reply */ }
      }
    });

    // Handle slash commands
    socketMode.on("slash_commands", async ({ body, ack }) => {
      if (!isSlackSlashCommandPayload(body)) {
        await ack({ text: "⚠️ Invalid slash command payload." });
        return;
      }
      const command = body.command ?? "";
      const channel = body.channel_id ?? "";
      const threadTs = typeof body.thread_ts === "string" ? body.thread_ts : undefined;

      try {
        const response = await this.commands.handleSlashCommand(command, channel, threadTs);
        await ack({ text: response });
      } catch (err) {
        console.error("[slack] Error handling slash command:", err);
        try {
          await ack({ text: "⚠️ Something went wrong. Please try again." });
        } catch (ackErr) {
          console.warn("[slack] Failed to ack slash command:", ackErr);
        }
      }
    });

    await this.client.connect();
    console.log("[slack] Slack adapter started");
  }

  /** Disconnect from Slack. */
  stop(): void {
    this.client.disconnect().catch((err) => {
      console.warn("[slack] Error disconnecting:", err);
    });
  }
}
