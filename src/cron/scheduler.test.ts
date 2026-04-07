import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseCron } from "./parser.js";
import { CronScheduler } from "./scheduler.js";

describe("CronScheduler channel targeting", () => {
  const telegramManager = { sendToCronSession: vi.fn() };
  const slackManager = { sendToCronSession: vi.fn() };

  const createScheduler = () =>
    new CronScheduler(
      new Map([
        [
          "telegram",
          {
            name: "telegram",
            sessionManager: telegramManager as never,
            defaultChatId: "tg-chat",
          },
        ],
        [
          "slack",
          {
            name: "slack",
            sessionManager: slackManager as never,
            defaultChatId: "slack-chat",
          },
        ],
      ]),
      "C:\\Repos\\htekdev\\gh-cli-telegram-extension.create-copilot-sdk-instead",
    );

  const runJob = async (channel?: "telegram" | "slack" | "all" | "unknown") => {
    const scheduler = createScheduler() as any;
    scheduler.config = { timezone: "UTC", jobs: [] };
    scheduler.parsedJobs = [
      {
        id: "job-1",
        schedule: "* * * * *",
        prompt: "Run it",
        channel,
        parsed: parseCron("* * * * *"),
      },
    ];

    await scheduler.checkSchedule();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    telegramManager.sendToCronSession.mockResolvedValue(undefined);
    slackManager.sendToCronSession.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each([undefined, "all"] as const)(
    'targets every channel when channel is %s',
    async (channel) => {
      await runJob(channel);

      expect(telegramManager.sendToCronSession).toHaveBeenCalledWith(
        "tg-chat",
        "job-1",
        "[Scheduled Task: job-1] Run it",
      );
      expect(slackManager.sendToCronSession).toHaveBeenCalledWith(
        "slack-chat",
        "job-1",
        "[Scheduled Task: job-1] Run it",
      );
    },
  );

  it.each([
    ["telegram", telegramManager, slackManager, "tg-chat"],
    ["slack", slackManager, telegramManager, "slack-chat"],
  ] as const)(
    "targets only the %s channel when requested",
    async (channel, expectedManager, otherManager, chatId) => {
      await runJob(channel);

      expect(expectedManager.sendToCronSession).toHaveBeenCalledWith(
        chatId,
        "job-1",
        "[Scheduled Task: job-1] Run it",
      );
      expect(otherManager.sendToCronSession).not.toHaveBeenCalled();
    },
  );

  it("returns no targets for an unknown channel", async () => {
    await runJob("unknown");

    expect(telegramManager.sendToCronSession).not.toHaveBeenCalled();
    expect(slackManager.sendToCronSession).not.toHaveBeenCalled();
  });
});
