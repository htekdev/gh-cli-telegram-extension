import type { MessagingChannel } from "../channels/types.js";
import type { Config } from "../config.js";
import { SlackClient } from "./client.js";
import { SlackThreadRouter } from "./thread-router.js";
import { SlackCommandHandler } from "./commands.js";
import { SessionManager } from "../sessions/manager.js";

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

  async sendMessage(chatId: string, text: string): Promise<void> {
    // chatId is "channel:threadTs" or "channel:default"
    const [channel, threadTs] = chatId.split(":");
    const ts = threadTs === "default" ? undefined : threadTs;
    await this.client.sendMessage(channel, text, ts);
  }

  async sendTypingAction(_chatId: string): Promise<void> {
    // Slack has no bot typing indicator
  }

  async start(): Promise<void> {
    await this.sessionManager.start();

    const socketMode = this.client.getSocketMode();

    // Handle regular messages
    socketMode.on("message", async ({ event, ack }) => {
      await ack();

      // Skip bot messages
      if (event.bot_id || event.subtype === "bot_message") return;

      const channel = event.channel as string;
      const text = (event.text as string) ?? "";
      const user = (event.user as string) ?? "Unknown";
      const threadTs = (event.thread_ts as string | undefined) ?? (event.ts as string | undefined);

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
      const command = body.command as string;
      const channel = body.channel_id as string;
      const threadTs = (body as Record<string, unknown>).thread_ts as string | undefined;

      try {
        const response = await this.commands.handleSlashCommand(command, channel, threadTs);
        await ack({ text: response });
      } catch (err) {
        console.error("[slack] Error handling slash command:", err);
        await ack({ text: "⚠️ Something went wrong. Please try again." });
      }
    });

    await this.client.connect();
    console.log("[slack] Slack adapter started");
  }

  stop(): void {
    this.client.disconnect().catch((err) => {
      console.warn("[slack] Error disconnecting:", err);
    });
  }
}
