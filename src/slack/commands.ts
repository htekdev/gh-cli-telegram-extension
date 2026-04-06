import type { SlackClient } from "./client.js";
import type { SlackThreadRouter } from "./thread-router.js";
import type { SessionManager } from "../sessions/manager.js";

export class SlackCommandHandler {
  private readonly slackClient: SlackClient;
  private readonly threadRouter: SlackThreadRouter;
  private readonly sessionManager: SessionManager;

  constructor(
    slackClient: SlackClient,
    threadRouter: SlackThreadRouter,
    sessionManager: SessionManager,
  ) {
    this.slackClient = slackClient;
    this.threadRouter = threadRouter;
    this.sessionManager = sessionManager;
  }

  isCommand(text: string): boolean {
    const lower = text.trim().toLowerCase();
    return (
      lower === "new" ||
      lower === "list" ||
      lower === "end" ||
      lower === "status" ||
      lower === "help"
    );
  }

  async handle(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<boolean> {
    const command = text.trim().toLowerCase();

    switch (command) {
      case "new":
        await this.handleNew(channel);
        return true;
      case "list":
        await this.handleList(channel, threadTs);
        return true;
      case "end":
        await this.handleEnd(channel, threadTs);
        return true;
      case "status":
        await this.handleStatus(channel, threadTs);
        return true;
      case "help":
        await this.handleHelp(channel, threadTs);
        return true;
      default:
        return false;
    }
  }

  async handleSlashCommand(
    command: string,
    channel: string,
    threadTs?: string,
  ): Promise<string> {
    switch (command) {
      case "/new":
        return await this.handleNewSlash(channel);
      case "/list":
        return this.formatList(channel);
      case "/end":
        return await this.handleEndSlash(channel, threadTs);
      case "/status":
        return this.formatStatus(channel);
      case "/help":
        return this.formatHelp();
      default:
        return `Unknown command: ${command}`;
    }
  }

  private async handleNew(channel: string): Promise<void> {
    const ts = await this.slackClient.sendMessage(
      channel,
      "🆕 New Copilot session — reply in this thread to chat",
    );
    if (ts) {
      const chatId = this.threadRouter.getChatId(channel, ts);
      await this.sessionManager.createSession(chatId, `slack-${channel}-${ts}`);
    }
  }

  private async handleNewSlash(channel: string): Promise<string> {
    const ts = await this.slackClient.sendMessage(
      channel,
      "🆕 New Copilot session — reply in this thread to chat",
    );
    if (ts) {
      const chatId = this.threadRouter.getChatId(channel, ts);
      await this.sessionManager.createSession(chatId, `slack-${channel}-${ts}`);
      return "✅ New session started — check the thread";
    }
    return "⚠️ Failed to create session thread";
  }

  private async handleList(channel: string, threadTs?: string): Promise<void> {
    const text = this.formatList(channel);
    await this.slackClient.sendMessage(channel, text, threadTs);
  }

  private formatList(channel: string): string {
    const sessions = this.threadRouter.listThreadSessions(channel);
    if (sessions.length === 0) {
      return "No active sessions. Say `new` or use `/new` to start one.";
    }
    const lines = sessions.map(
      (s, i) => `${i + 1}. ${s.sessionId} (thread: ${s.threadTs})`,
    );
    return `📋 Sessions (${sessions.length}):\n${lines.join("\n")}`;
  }

  private async handleEnd(channel: string, threadTs?: string): Promise<void> {
    const text = await this.handleEndSlash(channel, threadTs);
    await this.slackClient.sendMessage(channel, text, threadTs);
  }

  private async handleEndSlash(channel: string, threadTs?: string): Promise<string> {
    const ended = await this.threadRouter.endThreadSession(channel, threadTs);
    if (ended) {
      return `🔴 Session ended: ${ended}`;
    }
    return "No active session in this thread.";
  }

  private async handleStatus(channel: string, threadTs?: string): Promise<void> {
    const text = this.formatStatus(channel);
    await this.slackClient.sendMessage(channel, text, threadTs);
  }

  private formatStatus(channel: string): string {
    const sessions = this.threadRouter.listThreadSessions(channel);
    return (
      `📡 Bridge Status\n` +
      `• Channel: Slack\n` +
      `• Sessions: ${sessions.length}\n` +
      `• CopilotClient: ${this.sessionManager.isRunning() ? "running" : "stopped"}`
    );
  }

  private async handleHelp(channel: string, threadTs?: string): Promise<void> {
    const text = this.formatHelp();
    await this.slackClient.sendMessage(channel, text, threadTs);
  }

  private formatHelp(): string {
    return (
      "🤖 Slack ↔ Copilot Bridge\n\n" +
      "Each thread is a separate Copilot session.\n\n" +
      "Commands (slash or message):\n" +
      "• `new` / `/new` — start a new session thread\n" +
      "• `list` / `/list` — list active sessions\n" +
      "• `end` / `/end` — end session in current thread\n" +
      "• `status` / `/status` — bridge status\n" +
      "• `help` / `/help` — this message\n\n" +
      "Just reply in any thread to chat with Copilot."
    );
  }
}
