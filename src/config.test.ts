import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, loadMcpServers } from "./config.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadConfig", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `config-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    // Clear env vars
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.CLI_URL;
    delete process.env.CLI_PORT;
    delete process.env.CRON_ENABLED;
    delete process.env.LOG_LEVEL;
    delete process.env.MCP_CONFIG_PATH;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("loads config from .env file", () => {
    writeFileSync(
      join(testDir, ".env"),
      "TELEGRAM_BOT_TOKEN=test-token-123\nTELEGRAM_CHAT_ID=12345\n",
    );

    const config = loadConfig(testDir);
    expect(config.telegramBotToken).toBe("test-token-123");
    expect(config.telegramChatId).toBe("12345");
  });

  it("throws when no channel tokens are set", () => {
    writeFileSync(join(testDir, ".env"), "CRON_ENABLED=true\n");

    expect(() => loadConfig(testDir)).toThrow("At least one channel");
  });

  it("uses env vars over .env file", () => {
    process.env.TELEGRAM_BOT_TOKEN = "env-token";
    writeFileSync(
      join(testDir, ".env"),
      "TELEGRAM_BOT_TOKEN=file-token\n",
    );

    const config = loadConfig(testDir);
    expect(config.telegramBotToken).toBe("env-token");
  });

  it("parses CRON_ENABLED correctly", () => {
    writeFileSync(
      join(testDir, ".env"),
      "TELEGRAM_BOT_TOKEN=token\nCRON_ENABLED=true\n",
    );

    const config = loadConfig(testDir);
    expect(config.cronEnabled).toBe(true);
  });

  it("defaults CRON_ENABLED to false", () => {
    writeFileSync(join(testDir, ".env"), "TELEGRAM_BOT_TOKEN=token\n");

    const config = loadConfig(testDir);
    expect(config.cronEnabled).toBe(false);
  });

  it("handles quoted values in .env", () => {
    writeFileSync(
      join(testDir, ".env"),
      'TELEGRAM_BOT_TOKEN="quoted-token"\n',
    );

    const config = loadConfig(testDir);
    expect(config.telegramBotToken).toBe("quoted-token");
  });

  it("ignores comments and blank lines", () => {
    writeFileSync(
      join(testDir, ".env"),
      "# This is a comment\n\nTELEGRAM_BOT_TOKEN=token\n  \n# Another comment\n",
    );

    const config = loadConfig(testDir);
    expect(config.telegramBotToken).toBe("token");
  });

  it("parses CLI_PORT as number", () => {
    writeFileSync(
      join(testDir, ".env"),
      "TELEGRAM_BOT_TOKEN=token\nCLI_PORT=4321\n",
    );

    const config = loadConfig(testDir);
    expect(config.cliPort).toBe(4321);
  });

  it("loads MCP servers from mcp-servers.json when present", () => {
    writeFileSync(join(testDir, ".env"), "TELEGRAM_BOT_TOKEN=token\n");
    writeFileSync(
      join(testDir, "mcp-servers.json"),
      JSON.stringify({
        mcpServers: {
          exa: { tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" },
        },
      }),
    );

    const config = loadConfig(testDir);
    expect(config.mcpServers).toEqual({
      exa: { tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" },
    });
  });

  it("returns empty mcpServers when no MCP config file exists", () => {
    writeFileSync(join(testDir, ".env"), "TELEGRAM_BOT_TOKEN=token\n");

    const config = loadConfig(testDir);
    expect(config.mcpServers).toEqual({});
  });

  it("loads MCP servers from custom path via MCP_CONFIG_PATH", () => {
    const customDir = join(testDir, "custom");
    mkdirSync(customDir, { recursive: true });
    const customPath = join(customDir, "my-mcp.json");
    writeFileSync(
      customPath,
      JSON.stringify({
        mcpServers: {
          mslearn: { tools: ["*"], type: "http", url: "https://learn.microsoft.com/api/mcp" },
        },
      }),
    );
    writeFileSync(
      join(testDir, ".env"),
      `TELEGRAM_BOT_TOKEN=token\nMCP_CONFIG_PATH=${customPath}\n`,
    );

    const config = loadConfig(testDir);
    expect(config.mcpServers).toEqual({
      mslearn: { tools: ["*"], type: "http", url: "https://learn.microsoft.com/api/mcp" },
    });
  });
});

describe("loadMcpServers", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `mcp-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty object for missing file", () => {
    const result = loadMcpServers(join(testDir, "nonexistent.json"));
    expect(result).toEqual({});
  });

  it("parses native Copilot format with mcpServers wrapper", () => {
    const configPath = join(testDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          exa: { tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" },
          perplexity: {
            tools: ["*"],
            type: "local",
            command: "npx",
            args: ["-y", "perplexity-mcp"],
            env: { PERPLEXITY_API_KEY: "test-key" },
          },
        },
      }),
    );

    const result = loadMcpServers(configPath);
    expect(Object.keys(result)).toEqual(["exa", "perplexity"]);
    expect(result.exa).toEqual({ tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" });
    expect(result.perplexity).toMatchObject({
      command: "npx",
      args: ["-y", "perplexity-mcp"],
    });
  });

  it("parses flat format without mcpServers wrapper", () => {
    const configPath = join(testDir, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        exa: { tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" },
      }),
    );

    const result = loadMcpServers(configPath);
    expect(result.exa).toEqual({ tools: ["*"], type: "http", url: "https://mcp.exa.ai/mcp" });
  });

  it("throws on invalid JSON", () => {
    const configPath = join(testDir, "bad.json");
    writeFileSync(configPath, "not valid json {{{");

    expect(() => loadMcpServers(configPath)).toThrow("Failed to parse MCP config");
  });

  it("throws on non-object JSON", () => {
    const configPath = join(testDir, "array.json");
    writeFileSync(configPath, "[]");

    expect(() => loadMcpServers(configPath)).toThrow("must be a JSON object");
  });
});
