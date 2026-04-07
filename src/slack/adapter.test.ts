import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackAdapter } from "./adapter.js";
import type { Config } from "../config.js";

const handlers = vi.hoisted(() => new Map<string, (payload: any) => Promise<void>>());
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const connectMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const disconnectMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const routeMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const isCommandMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const handleMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const handleSlashCommandMock = vi.hoisted(() => vi.fn().mockResolvedValue("ok"));
const sessionStartMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./client.js", () => {
  class MockSocketMode {
    on(event: string, handler: (payload: any) => Promise<void>) {
      handlers.set(event, handler);
    }
  }
  const socketMode = new MockSocketMode();

  class SlackClient {
    getSocketMode() {
      return socketMode;
    }
    connect = connectMock;
    disconnect = disconnectMock;
    sendMessage = sendMessageMock;
  }

  return { SlackClient };
});

vi.mock("./thread-router.js", () => ({
  SlackThreadRouter: class {
    routeMessage = routeMessageMock;
    listThreadSessions = vi.fn().mockReturnValue([]);
    endThreadSession = vi.fn().mockResolvedValue(null);
    getChatId = vi.fn().mockReturnValue("channel:default");
  },
}));

vi.mock("./commands.js", () => ({
  SlackCommandHandler: class {
    isCommand = isCommandMock;
    handle = handleMock;
    handleSlashCommand = handleSlashCommandMock;
  },
}));

vi.mock("../sessions/manager.js", () => ({
  SessionManager: class {
    start = sessionStartMock;
    isRunning = vi.fn().mockReturnValue(true);
  },
}));

const baseConfig: Config = {
  telegramBotToken: undefined,
  telegramChatId: undefined,
  slackBotToken: "bot-token",
  slackAppToken: "app-token",
  slackChannelId: undefined,
  cliUrl: undefined,
  cliPort: undefined,
  cronEnabled: false,
  logLevel: "info",
};

const getHandler = (name: string) => handlers.get(name) as (payload: any) => Promise<void>;

describe("SlackAdapter", () => {
  beforeEach(() => {
    handlers.clear();
    sendMessageMock.mockClear();
    connectMock.mockClear();
    disconnectMock.mockClear();
    routeMessageMock.mockClear();
    isCommandMock.mockReset().mockReturnValue(false);
    handleMock.mockReset().mockResolvedValue(false);
    handleSlashCommandMock.mockReset().mockResolvedValue("ok");
    sessionStartMock.mockClear();
  });

  it("routes normal messages to the thread router", async () => {
    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      event: { channel: "C1", text: "hi", user: "U1", ts: "111.222" },
      ack,
    });

    expect(routeMessageMock).toHaveBeenCalledWith("C1", "hi", "U1", "111.222");
    adapter.stop();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it("prefers thread_ts when present", async () => {
    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      event: { channel: "C1", text: "hi", user: "U1", ts: "111.222", thread_ts: "999.000" },
      ack,
    });

    expect(routeMessageMock).toHaveBeenCalledWith("C1", "hi", "U1", "999.000");
  });

  it("skips bot/system messages and filtered channels", async () => {
    const adapter = new SlackAdapter({ ...baseConfig, slackChannelId: "C2" });
    await adapter.start();

    const handler = getHandler("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      event: { channel: "C1", text: "ignored", user: "U1", bot_id: "B1" },
      ack,
    });
    await handler({
      event: { channel: "C1", text: "ignored", user: "U1", subtype: "channel_join" },
      ack,
    });
    await handler({
      event: { channel: "C1", text: "ignored", user: "U1", ts: "1.2" },
      ack,
    });

    expect(routeMessageMock).not.toHaveBeenCalled();
  });

  it("short-circuits handled commands", async () => {
    isCommandMock.mockReturnValue(true);
    handleMock.mockResolvedValue(true);

    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      event: { channel: "C1", text: "new", user: "U1", ts: "111.222" },
      ack,
    });

    expect(handleMock).toHaveBeenCalled();
    expect(routeMessageMock).not.toHaveBeenCalled();
  });

  it("sends an error message when routing fails", async () => {
    routeMessageMock.mockRejectedValueOnce(new Error("fail"));
    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("message");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      event: { channel: "C1", text: "hi", user: "U1", ts: "111.222" },
      ack,
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      "C1",
      "⚠️ Something went wrong processing that message. Please try again.",
      "111.222",
    );
  });

  it("acks slash commands and handles errors", async () => {
    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("slash_commands");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({
      body: { command: "/status", channel_id: "C1", thread_ts: "9.9" },
      ack,
    });
    expect(handleSlashCommandMock).toHaveBeenCalledWith("/status", "C1", "9.9");
    expect(ack).toHaveBeenCalledWith({ text: "ok" });

    handleSlashCommandMock.mockRejectedValueOnce(new Error("boom"));
    const errorAck = vi.fn().mockResolvedValue(undefined);
    await handler({
      body: { command: "/status", channel_id: "C1" },
      ack: errorAck,
    });
    expect(errorAck).toHaveBeenCalledWith({ text: "⚠️ Something went wrong. Please try again." });
  });

  it("rejects invalid slash payloads", async () => {
    const adapter = new SlackAdapter(baseConfig);
    await adapter.start();

    const handler = getHandler("slash_commands");
    const ack = vi.fn().mockResolvedValue(undefined);
    await handler({ body: { channel_id: "C1" }, ack });
    expect(ack).toHaveBeenCalledWith({ text: "⚠️ Invalid slash command payload." });
  });
});
