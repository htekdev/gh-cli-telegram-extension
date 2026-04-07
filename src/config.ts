import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  slackBotToken: z.string().optional(),
  slackAppToken: z.string().optional(),
  slackChannelId: z.string().optional(),
  cliUrl: z.string().optional(),
  cliPort: z.coerce.number().int().positive().optional(),
  cronEnabled: z.boolean().default(false),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/** Runtime configuration derived from environment variables. */
export type Config = z.infer<typeof configSchema>;

function parseEnvFile(filePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(filePath)) return vars;

  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function getEnv(key: string, envFile: Record<string, string>): string | undefined {
  return process.env[key] || envFile[key] || undefined;
}

/** Load configuration from environment variables and optional .env file. */
export function loadConfig(cwd: string = process.cwd()): Config {
  const envFilePath = resolve(cwd, ".env");
  const envFile = parseEnvFile(envFilePath);

  const raw = {
    telegramBotToken: getEnv("TELEGRAM_BOT_TOKEN", envFile),
    telegramChatId: getEnv("TELEGRAM_CHAT_ID", envFile),
    slackBotToken: getEnv("SLACK_BOT_TOKEN", envFile),
    slackAppToken: getEnv("SLACK_APP_TOKEN", envFile),
    slackChannelId: getEnv("SLACK_CHANNEL_ID", envFile),
    cliUrl: getEnv("CLI_URL", envFile),
    cliPort: getEnv("CLI_PORT", envFile),
    cronEnabled:
      getEnv("CRON_ENABLED", envFile) === "true" ||
      getEnv("CRON_ENABLED", envFile) === "1",
    logLevel: getEnv("LOG_LEVEL", envFile) ?? "info",
  };

  const config = configSchema.parse(raw);

  // At least one channel must be configured
  if (!config.telegramBotToken && !config.slackBotToken) {
    throw new Error("At least one channel must be configured: set TELEGRAM_BOT_TOKEN and/or SLACK_BOT_TOKEN + SLACK_APP_TOKEN");
  }

  return config;
}
