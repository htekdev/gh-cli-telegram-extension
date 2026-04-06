import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { HttpsProxyAgent } from "https-proxy-agent";

export class SlackClient {
  private readonly socketMode: SocketModeClient;
  private readonly web: WebClient;

  constructor(appToken: string, botToken: string) {
    // OpenShell sandbox routes all traffic through an HTTP proxy.
    // Node.js fetch() respects HTTPS_PROXY automatically, but the Slack
    // Socket Mode WebSocket client needs an explicit proxy agent.
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

    this.socketMode = new SocketModeClient({
      appToken,
      clientOptions: { agent },
    });
    this.web = new WebClient(botToken, { agent });
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
