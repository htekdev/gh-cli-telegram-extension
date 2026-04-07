import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandHandler } from "./commands.js";
import type { TelegramMessage } from "./api.js";

describe("CommandHandler", () => {
  const sessionManager = {
    createSession: vi.fn(),
    switchSession: vi.fn(),
    getSessionCount: vi.fn(),
    listSessions: vi.fn(),
    getActiveSessionId: vi.fn(),
    endSession: vi.fn(),
    isRunning: vi.fn(),
  };

  const telegram = {
    sendMessage: vi.fn(),
  };

  let handler: CommandHandler;

  const message = (text: string): TelegramMessage => ({
    message_id: 1,
    chat: { id: 42, type: "private" },
    date: 0,
    text,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new CommandHandler(sessionManager as never, telegram as never);
    sessionManager.switchSession.mockResolvedValue({
      sessionId: "session-2",
      chatId: "42",
      createdAt: new Date(),
    });
    sessionManager.getSessionCount.mockReturnValue(3);
    telegram.sendMessage.mockResolvedValue(undefined);
  });

  it.each(["/start", "/new", "/switch", "/list", "/end", "/status", "/help"])(
    "detects %s as a command",
    (command) => {
      expect(handler.isCommand(command)).toBe(true);
    },
  );

  it.each(["hello", " /start", "status", "hello /help"])(
    "returns false for regular message %s",
    (text) => {
      expect(handler.isCommand(text)).toBe(false);
    },
  );

  it("parses the switch index and switches sessions", async () => {
    await expect(handler.handle(message("/switch 2"))).resolves.toBe(true);

    expect(sessionManager.switchSession).toHaveBeenCalledWith("42", 2);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      "🔄 Switched to session #2: session-2",
    );
  });

  it.each(["/switch", "/switch 0", "/switch abc", "/switch -1"])(
    "rejects malformed switch index for %s",
    async (text) => {
      await expect(handler.handle(message(text))).resolves.toBe(true);

      expect(sessionManager.switchSession).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        "42",
        "Usage: /switch N (where N is the session number from /list)",
      );
    },
  );

  it("rejects unavailable switch indices", async () => {
    sessionManager.switchSession.mockResolvedValueOnce(null);

    await expect(handler.handle(message("/switch 9"))).resolves.toBe(true);

    expect(sessionManager.switchSession).toHaveBeenCalledWith("42", 9);
    expect(sessionManager.getSessionCount).toHaveBeenCalledWith("42");
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      "42",
      "❌ Invalid session number. You have 3 session(s). Use /list to see them.",
    );
  });
});
