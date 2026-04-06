import { loadConfig } from "./config.js";
import { TelegramAdapter } from "./telegram/adapter.js";
import { SlackAdapter } from "./slack/adapter.js";
import { CronScheduler } from "./cron/scheduler.js";
import type { MessagingChannel } from "./channels/types.js";

interface ChannelWithManager {
  channel: MessagingChannel;
  sessionManager: { stop(): Promise<void> };
}

async function main(): Promise<void> {
  console.log("🤖 Copilot Bridge Service starting...");

  const config = loadConfig();
  console.log("[config] Configuration loaded");

  const channels: ChannelWithManager[] = [];

  // Start Telegram if configured
  if (config.telegramBotToken) {
    console.log("[telegram] Telegram channel enabled");
    const telegram = new TelegramAdapter(config);
    channels.push({ channel: telegram, sessionManager: telegram.sessionManager });
  }

  // Start Slack if configured
  if (config.slackBotToken && config.slackAppToken) {
    console.log("[slack] Slack channel enabled");
    const slack = new SlackAdapter(config);
    channels.push({ channel: slack, sessionManager: slack.sessionManager });
  }

  if (channels.length === 0) {
    console.error("❌ No channels configured. Set TELEGRAM_BOT_TOKEN and/or SLACK_BOT_TOKEN + SLACK_APP_TOKEN.");
    process.exit(1);
  }

  // Start cron scheduler (targets first channel's session manager)
  let cronScheduler: CronScheduler | null = null;
  if (config.cronEnabled) {
    const primaryManager = channels[0].sessionManager as import("./sessions/manager.js").SessionManager;
    const cronChatId = config.telegramChatId || config.slackChannelId;
    cronScheduler = new CronScheduler(primaryManager, cronChatId);
    cronScheduler.start();
  } else {
    console.log("[cron] ⏰ Cron scheduler disabled (set CRON_ENABLED=true to activate)");
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[bridge] Received ${signal}, shutting down...`);

    for (const { channel, sessionManager } of channels) {
      channel.stop();
      try {
        await sessionManager.stop();
      } catch (err) {
        console.error(`[bridge] Error stopping ${channel.name}:`, err);
      }
    }
    cronScheduler?.stop();

    console.log("[bridge] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start all channels (Telegram poller blocks, Slack Socket Mode runs async)
  const startPromises = channels.map((c) => c.channel.start());

  // If only Slack (no blocking poller), keep process alive
  if (!config.telegramBotToken && config.slackBotToken) {
    await Promise.all(startPromises);
    console.log("[bridge] All channels started. Waiting for events...");
    // Keep alive
    await new Promise(() => {});
  } else {
    await Promise.all(startPromises);
  }
}

main().catch((err) => {
  console.error("❌ Bridge service crashed:", err);
  process.exit(1);
});

