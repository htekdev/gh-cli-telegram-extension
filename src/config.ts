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
  mcpConfigPath: z.string().optional(),
});

/** MCP server configuration types matching the CopilotClient SDK. */
export interface MCPLocalServerConfig {
  type?: "local" | "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  tools: string[];
  timeout?: number;
}

export interface MCPRemoteServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  tools: string[];
  timeout?: number;
}

export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

/** Runtime configuration derived from environment variables. */
export type Config = Omit<z.infer<typeof configSchema>, "mcpConfigPath"> & {
  mcpServers: Record<string, MCPServerConfig>;
};

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

/**
 * Load MCP server configurations from a JSON file.
 * Supports both the native Copilot format `{ "mcpServers": { ... } }` and
 * a flat `Record<string, MCPServerConfig>` object.
 * Returns an empty object if the file does not exist.
 */
export function loadMcpServers(configPath: string): Record<string, MCPServerConfig> {
  if (!existsSync(configPath)) {
    return {};
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to parse MCP config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`MCP config at ${configPath} must be a JSON object`);
  }

  // Support native Copilot format: { "mcpServers": { ... } }
  const obj = raw as Record<string, unknown>;
  const servers = (typeof obj.mcpServers === "object" && obj.mcpServers !== null && !Array.isArray(obj.mcpServers))
    ? obj.mcpServers as Record<string, MCPServerConfig>
    : obj as Record<string, MCPServerConfig>;

  return servers;
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
    mcpConfigPath: getEnv("MCP_CONFIG_PATH", envFile),
  };

  const parsed = configSchema.parse(raw);

  // At least one channel must be configured
  if (!parsed.telegramBotToken && !parsed.slackBotToken) {
    throw new Error("At least one channel must be configured: set TELEGRAM_BOT_TOKEN and/or SLACK_BOT_TOKEN + SLACK_APP_TOKEN");
  }

  // Load MCP server configs from file
  const mcpPath = parsed.mcpConfigPath
    ? resolve(cwd, parsed.mcpConfigPath)
    : resolve(cwd, "mcp-servers.json");
  const mcpServers = loadMcpServers(mcpPath);

  const serverCount = Object.keys(mcpServers).length;
  if (serverCount > 0) {
    console.log(`[config] Loaded ${serverCount} MCP server(s) from ${mcpPath}`);
  } else if (parsed.mcpConfigPath) {
    console.warn(`[config] MCP config path set but no servers loaded from ${mcpPath}`);
  }

  const { mcpConfigPath: _, ...rest } = parsed;
  return { ...rest, mcpServers };
}
