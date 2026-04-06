import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";
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

  it("throws when TELEGRAM_BOT_TOKEN is missing", () => {
    writeFileSync(join(testDir, ".env"), "CRON_ENABLED=true\n");

    expect(() => loadConfig(testDir)).toThrow();
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
});
