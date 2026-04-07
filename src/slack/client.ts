import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { HttpsProxyAgent } from "https-proxy-agent";

/** Slack Socket Mode + Web API wrapper used by the adapter. */
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

  /** Return the underlying Socket Mode client. */
  getSocketMode(): SocketModeClient {
    return this.socketMode;
  }

  /** Connect to Slack Socket Mode. */
  async connect(): Promise<void> {
    await this.socketMode.start();
    console.log("[slack] Socket Mode connected");
  }

  /** Disconnect from Slack Socket Mode. */
  async disconnect(): Promise<void> {
    await this.socketMode.disconnect();
    console.log("[slack] Socket Mode disconnected");
  }

  /** Post a message to Slack and return the timestamp if created. */
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

  /** Slack bots don't support typing indicators; this is a no-op. */
  async sendTypingAction(_channel: string): Promise<void> {
    // Slack doesn't have a typing indicator API for bots — no-op
  }
}
