import { loadConfig } from "./config.js";
import { TelegramApi } from "./telegram/api.js";
import { SessionManager } from "./sessions/manager.js";
import { CommandHandler } from "./telegram/commands.js";
import { MessageRouter } from "./telegram/router.js";
import { TelegramPoller } from "./telegram/poller.js";
import { CronScheduler } from "./cron/scheduler.js";

async function main(): Promise<void> {
  console.log("🤖 Copilot Telegram Bridge Service starting...");

  // 1. Load configuration
  const config = loadConfig();
  console.log("[config] Configuration loaded");

  // 2. Initialize Telegram API
  const telegram = new TelegramApi(config.telegramBotToken);

  // 3. Start session manager (CopilotClient)
  const sessionManager = new SessionManager(config, telegram);
  await sessionManager.start();

  // 4. Set up Telegram command handler and message router
  const commands = new CommandHandler(sessionManager, telegram);
  const router = new MessageRouter(sessionManager, telegram);

  // 5. Start Telegram poller
  const poller = new TelegramPoller({
    telegram,
    commands,
    router,
    chatId: config.telegramChatId,
  });

  // 6. Start cron scheduler
  let cronScheduler: CronScheduler | null = null;
  if (config.cronEnabled) {
    cronScheduler = new CronScheduler(sessionManager, config.telegramChatId);
    cronScheduler.start();
  } else {
    console.log("[cron] ⏰ Cron scheduler disabled (set CRON_ENABLED=true to activate)");
  }

  // 7. Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[bridge] Received ${signal}, shutting down...`);

    poller.stop();
    cronScheduler?.stop();

    try {
      await sessionManager.stop();
    } catch (err) {
      console.error("[bridge] Error during shutdown:", err);
    }

    console.log("[bridge] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start polling (blocks until stopped)
  await poller.start();
}

main().catch((err) => {
  console.error("❌ Bridge service crashed:", err);
  process.exit(1);
});
