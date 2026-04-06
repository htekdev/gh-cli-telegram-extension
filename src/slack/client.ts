import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";

export class SlackClient {
  private readonly socketMode: SocketModeClient;
  private readonly web: WebClient;

  constructor(appToken: string, botToken: string) {
    this.socketMode = new SocketModeClient({ appToken });
    this.web = new WebClient(botToken);
  }

  getSocketMode(): SocketModeClient {
    return this.socketMode;
  }

  async connect(): Promise<void> {
    await this.socketMode.start();
    console.log("[slack] Socket Mode connected");
  }

  async disconnect(): Promise<void> {
    await this.socketMode.disconnect();
    console.log("[slack] Socket Mode disconnected");
  }

  async sendMessage(channel: string, text: string, threadTs?: string): Promise<string | undefined> {
    if (!text || text.trim().length === 0) return undefined;

    const result = await this.web.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
      unfurl_links: false,
    });
    return result.ts;
  }

  async sendTypingAction(_channel: string): Promise<void> {
    // Slack doesn't have a typing indicator API for bots — no-op
  }
}
