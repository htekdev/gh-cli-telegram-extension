import { describe, it, expect, vi, afterEach } from "vitest";
import { SessionManager } from "./manager.js";
import type { Config } from "../config.js";
import type { MessagingChannel } from "../channels/types.js";

vi.mock("@github/copilot-sdk", () => {
  type Handler = (payload: unknown) => void;

  class MockSession {
    sessionId: string;
    send = vi.fn().mockResolvedValue("message-id");
    disconnect = vi.fn().mockResolvedValue(undefined);
    private handlers = new Map<string, Handler[]>();

    constructor(sessionId: string) {
      this.sessionId = sessionId;
    }

    on(eventType: string, handler: Handler) {
      const list = this.handlers.get(eventType) ?? [];
      list.push(handler);
      this.handlers.set(eventType, list);
      return () => {
        const next = (this.handlers.get(eventType) ?? []).filter((h) => h !== handler);
        this.handlers.set(eventType, next);
      };
    }

    emit(eventType: string, payload: unknown) {
      for (const handler of this.handlers.get(eventType) ?? []) {
        handler(payload);
      }
    }
  }

  class CopilotClient {
    sessions = new Map<string, MockSession>();
    resumeFailures = new Set<string>();
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    deleteSession = vi.fn().mockResolvedValue(undefined);
    createSession = vi.fn().mockImplementation(async (options: { sessionId: string }) => {
      const session = new MockSession(options.sessionId);
      this.sessions.set(options.sessionId, session);
      return session;
    });
    resumeSession = vi.fn().mockImplementation(async (sessionId: string) => {
      if (this.resumeFailures.has(sessionId)) {
        throw new Error("resume failed");
      }
      const session = new MockSession(sessionId);
      this.sessions.set(sessionId, session);
      return session;
    });
  }

  return { CopilotClient, approveAll: vi.fn() };
});

const baseConfig: Config = {
  telegramBotToken: undefined,
  telegramChatId: undefined,
  slackBotToken: undefined,
  slackAppToken: undefined,
  slackChannelId: undefined,
  cliUrl: undefined,
  cliPort: undefined,
  cronEnabled: false,
  logLevel: "info",
};

const createChannel = (): MessagingChannel => ({
  name: "test",
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendTypingAction: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
});

describe("SessionManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("forwards assistant messages once per session", async () => {
    const channel = createChannel();
    const manager = new SessionManager(baseConfig, channel);
    await manager.start();

    await manager.createSession("chat-1", "session-1");
    await manager.createSession("chat-1", "session-1");

    const client = (manager as unknown as { client: { sessions: Map<string, { emit: (eventType: string, payload: unknown) => void }> } }).client;
    const session = client.sessions.get("session-1")!;

    (channel.sendMessage as ReturnType<typeof vi.fn>).mockClear();
    session.emit("assistant.message", { data: { content: "Hello" } });
    expect(channel.sendMessage).toHaveBeenCalledTimes(1);
    expect(channel.sendMessage).toHaveBeenCalledWith("chat-1", "Hello");

    await manager.stop();
  });

  it("uses resume fallback and clears typing on idle", async () => {
    vi.useFakeTimers();
    const channel = createChannel();
    const manager = new SessionManager(baseConfig, channel);
    await manager.start();

    const client = (manager as unknown as { client: { resumeFailures: Set<string>; sessions: Map<string, { emit: (eventType: string, payload: unknown) => void }> } }).client;
    client.resumeFailures.add("resume-me");

    await manager.createSession("chat-2", "resume-me");
    await manager.sendMessage("chat-2", "hello", [
      { type: "blob", data: "abc", mimeType: "text/plain", displayName: "note.txt" },
    ]);

    const typingIntervals = (manager as unknown as { typingIntervals: Map<string, NodeJS.Timeout> }).typingIntervals;
    expect(typingIntervals.has("chat-2")).toBe(true);

    const session = client.sessions.get("resume-me")!;
    session.emit("session.idle");
    expect(typingIntervals.has("chat-2")).toBe(false);

    await manager.stop();
  });

  it("keeps active session when sending to cron", async () => {
    vi.useFakeTimers();
    const channel = createChannel();
    const manager = new SessionManager(baseConfig, channel);
    await manager.start();

    const info = await manager.createSession("chat-3", "user-session");
    await manager.sendToCronSession("chat-3", "job-1", "do it");

    const client = (manager as unknown as { client: { sessions: Map<string, { emit: (eventType: string, payload: unknown) => void }> } }).client;
    const cronSession = client.sessions.get("cron-job-1")!;
    expect(cronSession).toBeDefined();
    expect((cronSession as unknown as { send: ReturnType<typeof vi.fn> }).send).toHaveBeenCalled();

    const active = manager.getActiveSessionId("chat-3");
    expect(active).toBe(info.sessionId);

    cronSession.emit("session.idle");
    await manager.stop();
  });

  it("resumes on switch and cleans up on end", async () => {
    const channel = createChannel();
    const manager = new SessionManager(baseConfig, channel);
    await manager.start();

    await manager.createSession("chat-4", "session-a");
    const internals = manager as unknown as {
      sessionMap: Map<string, { emit: (eventType: string, payload: unknown) => void }>;
      attachedSessions: Set<string>;
    };
    internals.sessionMap.delete("session-a");
    internals.attachedSessions.delete("session-a");

    const switched = await manager.switchSession("chat-4", 1);
    expect(switched?.sessionId).toBe("session-a");

    const client = (manager as unknown as { client: { sessions: Map<string, { emit: (eventType: string, payload: unknown) => void }> } }).client;
    const resumed = client.sessions.get("session-a")!;
    (channel.sendMessage as ReturnType<typeof vi.fn>).mockClear();
    resumed.emit("assistant.message", { data: { content: "Resumed" } });
    expect(channel.sendMessage).toHaveBeenCalledWith("chat-4", "Resumed");

    await manager.endSession("chat-4");
    expect(internals.sessionMap.has("session-a")).toBe(false);
    expect(internals.attachedSessions.has("session-a")).toBe(false);

    await manager.stop();
  });
});
