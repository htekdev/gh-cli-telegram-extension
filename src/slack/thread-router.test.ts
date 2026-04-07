import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlackThreadRouter } from "./thread-router.js";

describe("SlackThreadRouter", () => {
  const sessionManager = {
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    endSession: vi.fn(),
  };

  const slackClient = {};
  let router: SlackThreadRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    router = new SlackThreadRouter(sessionManager as never, slackClient as never);
    sessionManager.createSession.mockResolvedValue({
      sessionId: "unused",
      chatId: "unused",
      createdAt: new Date(),
    });
    sessionManager.sendMessage.mockResolvedValue(undefined);
    sessionManager.endSession.mockResolvedValue("ended-session");
  });

  it("returns the expected chat id format", () => {
    expect(router.getChatId("C123", "123.456")).toBe("C123:123.456");
    expect(router.getChatId("C123")).toBe("C123:default");
  });

  it("creates one session per thread and sanitizes dots in thread_ts", async () => {
    await router.routeMessage("C123", "hello", "alice", "123.456");
    await router.routeMessage("C123", "follow-up", "alice", "123.456");

    expect(sessionManager.createSession).toHaveBeenCalledTimes(1);
    expect(sessionManager.createSession).toHaveBeenCalledWith(
      "C123:123.456",
      "slack-C123-123-456",
    );
    expect(sessionManager.sendMessage).toHaveBeenNthCalledWith(
      1,
      "C123:123.456",
      "[Slack from alice]: hello",
    );
    expect(sessionManager.sendMessage).toHaveBeenNthCalledWith(
      2,
      "C123:123.456",
      "[Slack from alice]: follow-up",
    );
  });

  it("lists only sessions for the requested channel", async () => {
    await router.routeMessage("C123", "one", "alice", "111.111");
    await router.routeMessage("C123", "two", "alice", "222.222");
    await router.routeMessage("C999", "other", "bob", "333.333");

    expect(router.listThreadSessions("C123")).toEqual([
      { sessionId: "slack-C123-111-111", threadTs: "111.111" },
      { sessionId: "slack-C123-222-222", threadTs: "222.222" },
    ]);
    expect(router.listThreadSessions("C999")).toEqual([
      { sessionId: "slack-C999-333-333", threadTs: "333.333" },
    ]);
  });

  it("removes the mapping when a thread session ends", async () => {
    await router.routeMessage("C123", "hello", "alice", "123.456");

    await expect(router.endThreadSession("C123", "123.456")).resolves.toBe("ended-session");

    expect(sessionManager.endSession).toHaveBeenCalledWith("C123:123.456");
    expect(router.listThreadSessions("C123")).toEqual([]);

    await router.routeMessage("C123", "new message", "alice", "123.456");
    expect(sessionManager.createSession).toHaveBeenCalledTimes(2);
  });
});
