import type { SessionManager } from "../sessions/manager.js";
import type { TelegramApi, TelegramMessage } from "./api.js";

export class CommandHandler {
  private readonly sessionManager: SessionManager;
  private readonly telegram: TelegramApi;

  constructor(sessionManager: SessionManager, telegram: TelegramApi) {
    this.sessionManager = sessionManager;
    this.telegram = telegram;
  }

  isCommand(text: string): boolean {
    return text.startsWith("/");
  }

  async handle(msg: TelegramMessage): Promise<boolean> {
    const text = msg.text?.trim() ?? "";
    if (!this.isCommand(text)) return false;

    const chatId = String(msg.chat.id);
    const [command, ...args] = text.split(/\s+/);

    switch (command.toLowerCase()) {
      case "/start":
        await this.handleStart(chatId);
        return true;
      case "/new":
        await this.handleNew(chatId);
        return true;
      case "/switch":
        await this.handleSwitch(chatId, args);
        return true;
      case "/list":
        await this.handleList(chatId);
        return true;
      case "/end":
        await this.handleEnd(chatId);
        return true;
      case "/status":
        await this.handleStatus(chatId);
        return true;
      case "/help":
        await this.handleHelp(chatId);
        return true;
      default:
        return false;
    }
  }

  private async handleStart(chatId: string): Promise<void> {
    const info = await this.sessionManager.createSession(chatId);
    await this.telegram.sendMessage(
      chatId,
      `✅ Connected! Your chat ID is: ${chatId}\n\n` +
        `A Copilot session has been created (${info.sessionId}).\n\n` +
        `Send any message and it will be forwarded to your GitHub Copilot session.\n\n` +
        `Commands:\n` +
        `/new — start a new session\n` +
        `/switch N — switch to session N\n` +
        `/list — list all sessions\n` +
        `/end — end current session\n` +
        `/status — bridge status\n` +
        `/help — show this message`,
    );
  }

  private async handleNew(chatId: string): Promise<void> {
    const info = await this.sessionManager.createSession(chatId);
    const count = this.sessionManager.getSessionCount(chatId);
    await this.telegram.sendMessage(
      chatId,
      `🆕 New session created: ${info.sessionId}\n` +
        `You now have ${count} active session(s). Switched to the new session.`,
    );
  }

  private async handleSwitch(chatId: string, args: string[]): Promise<void> {
    const index = parseInt(args[0], 10);
    if (isNaN(index) || index < 1) {
      await this.telegram.sendMessage(
        chatId,
        "Usage: /switch N (where N is the session number from /list)",
      );
      return;
    }

    const info = await this.sessionManager.switchSession(chatId, index);
    if (!info) {
      const count = this.sessionManager.getSessionCount(chatId);
      await this.telegram.sendMessage(
        chatId,
        `❌ Invalid session number. You have ${count} session(s). Use /list to see them.`,
      );
      return;
    }

    await this.telegram.sendMessage(
      chatId,
      `🔄 Switched to session #${index}: ${info.sessionId}`,
    );
  }

  private async handleList(chatId: string): Promise<void> {
    const sessions = this.sessionManager.listSessions(chatId);
    const activeId = this.sessionManager.getActiveSessionId(chatId);

    if (sessions.length === 0) {
      await this.telegram.sendMessage(
        chatId,
        "No active sessions. Send a message or use /new to create one.",
      );
      return;
    }

    const lines = sessions.map((s, i) => {
      const marker = s.sessionId === activeId ? " ◀ active" : "";
      const age = formatAge(Date.now() - s.createdAt.getTime());
      const icon = s.sessionId.startsWith("cron-") ? "⏰" : "💬";
      return `${i + 1}. ${icon} ${s.sessionId} (${age})${marker}`;
    });

    await this.telegram.sendMessage(
      chatId,
      `📋 Sessions (${sessions.length}):\n\n${lines.join("\n")}`,
    );
  }

  private async handleEnd(chatId: string): Promise<void> {
    const endedId = await this.sessionManager.endSession(chatId);
    if (!endedId) {
      await this.telegram.sendMessage(chatId, "No active session to end.");
      return;
    }

    const remaining = this.sessionManager.getSessionCount(chatId);
    const activeId = this.sessionManager.getActiveSessionId(chatId);
    let msg = `🔴 Session ended: ${endedId}`;
    if (remaining > 0 && activeId) {
      msg += `\nSwitched to: ${activeId} (${remaining} remaining)`;
    } else {
      msg += `\nNo sessions remaining. Send a message or use /new to start one.`;
    }
    await this.telegram.sendMessage(chatId, msg);
  }

  private async handleStatus(chatId: string): Promise<void> {
    const sessions = this.sessionManager.listSessions(chatId);
    const activeId = this.sessionManager.getActiveSessionId(chatId);
    const running = this.sessionManager.isRunning();

    await this.telegram.sendMessage(
      chatId,
      `📡 Bridge Status\n` +
        `• CopilotClient: ${running ? "running" : "stopped"}\n` +
        `• Chat ID: ${chatId}\n` +
        `• Sessions: ${sessions.length}\n` +
        `• Active: ${activeId ?? "none"}`,
    );
  }

  private async handleHelp(chatId: string): Promise<void> {
    await this.telegram.sendMessage(
      chatId,
      `🤖 Telegram ↔ Copilot Bridge\n\n` +
        `Send any text or photo message to interact with your Copilot session.\n\n` +
        `Session commands:\n` +
        `/new — start a new parallel session\n` +
        `/switch N — switch to session N\n` +
        `/list — list all active sessions\n` +
        `/end — end current session\n\n` +
        `Info commands:\n` +
        `/start — welcome message\n` +
        `/status — bridge & session status\n` +
        `/help — this message`,
    );
  }
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
