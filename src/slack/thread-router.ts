import type { SessionManager } from "../sessions/manager.js";
import type { SlackClient } from "./client.js";

export class SlackThreadRouter {
  private readonly sessionManager: SessionManager;
  private readonly slackClient: SlackClient;
  // Maps "channelId:threadTs" → sessionId
  private readonly threadSessions = new Map<string, string>();

  constructor(sessionManager: SessionManager, slackClient: SlackClient) {
    this.sessionManager = sessionManager;
    this.slackClient = slackClient;
  }

  private getSessionKey(channel: string, threadTs?: string): string {
    return threadTs ? `${channel}:${threadTs}` : `${channel}:default`;
  }

  private getSessionId(channel: string, threadTs?: string): string {
    return threadTs ? `slack-${channel}-${threadTs}` : `slack-${channel}-default`;
  }

  getChatId(channel: string, threadTs?: string): string {
    // Encode channel + thread as chatId for session manager
    return threadTs ? `${channel}:${threadTs}` : `${channel}:default`;
  }

  async routeMessage(
    channel: string,
    text: string,
    user: string,
    threadTs?: string,
  ): Promise<void> {
    const chatId = this.getChatId(channel, threadTs);
    const sessionKey = this.getSessionKey(channel, threadTs);
    const sessionId = this.getSessionId(channel, threadTs);

    // Ensure session exists for this thread
    if (!this.threadSessions.has(sessionKey)) {
      await this.sessionManager.createSession(chatId, sessionId);
      this.threadSessions.set(sessionKey, sessionId);
    }

    const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
    console.log(`[slack-router] 💬 ${user}: ${preview}`);

    await this.sessionManager.sendMessage(chatId, `[Slack from ${user}]: ${text}`);
  }

  async endThreadSession(channel: string, threadTs?: string): Promise<string | null> {
    const chatId = this.getChatId(channel, threadTs);
    const sessionKey = this.getSessionKey(channel, threadTs);

    const ended = await this.sessionManager.endSession(chatId);
    if (ended) {
      this.threadSessions.delete(sessionKey);
    }
    return ended;
  }

  listThreadSessions(channel: string): Array<{ sessionId: string; threadTs: string }> {
    const results: Array<{ sessionId: string; threadTs: string }> = [];
    for (const [key, sessionId] of this.threadSessions) {
      if (key.startsWith(`${channel}:`)) {
        const threadTs = key.split(":")[1];
        results.push({ sessionId, threadTs });
      }
    }
    return results;
  }
}
