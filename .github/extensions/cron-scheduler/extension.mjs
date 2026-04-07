/**
 * Cron Scheduler Extension for GitHub Copilot CLI
 *
 * Reads scheduled jobs from cron.json and fires session.send() at the
 * configured times. Responses flow back through whatever messaging
 * extension is active (e.g., the Telegram bridge).
 *
 * Zero dependencies — pure JS cron matching.
 *
 * Set BRIDGE_MODE=standalone in .env to disable this extension
 * (when using the standalone bridge service instead).
 */
import { readFileSync, existsSync, watchFile } from "node:fs";
import { resolve } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Skip if standalone bridge service is handling cron
// ---------------------------------------------------------------------------
function checkBridgeMode() {
  if (process.env.BRIDGE_MODE === "standalone") return true;
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "BRIDGE_MODE=standalone") return true;
  }
  return false;
}

if (checkBridgeMode()) {
  await joinSession({ tools: [] });
} else {

// ---------------------------------------------------------------------------
// Read CRON_ENABLED from .env if not in environment
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
if (!process.env.CRON_ENABLED && existsSync(ENV_FILE)) {
  const envContent = readFileSync(ENV_FILE, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CRON_ENABLED=")) {
      process.env.CRON_ENABLED = trimmed.slice("CRON_ENABLED=".length).trim();
    }
  }
}

// ---------------------------------------------------------------------------
// Cron parser — supports 5-field expressions (min hour dom month dow)
// Fields: *, N, N-M (range), N,M,O (list), */N (step), N-M/S (range+step)
// ---------------------------------------------------------------------------
function parseCronField(field, min, max) {
  const values = new Set();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2], 10);
      let rangeStart = min;
      let rangeEnd = max;

      if (stepMatch[1] !== "*") {
        const rangeParts = stepMatch[1].split("-");
        rangeStart = parseInt(rangeParts[0], 10);
        if (rangeParts.length === 2) rangeEnd = parseInt(rangeParts[1], 10);
      }

      for (let i = rangeStart; i <= rangeEnd; i += step) values.add(i);
      continue;
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    values.add(parseInt(part, 10));
  }

  return values;
}

function parseCron(expression) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" (need 5 fields)`);
  }

  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: parseCronField(fields[4], 0, 6),
  };
}

function cronMatches(parsed, date) {
  return (
    parsed.minutes.has(date.getMinutes()) &&
    parsed.hours.has(date.getHours()) &&
    parsed.daysOfMonth.has(date.getDate()) &&
    parsed.months.has(date.getMonth() + 1) &&
    parsed.daysOfWeek.has(date.getDay())
  );
}

// ---------------------------------------------------------------------------
// Timezone helper — convert UTC now to a Date-like in the target timezone
// ---------------------------------------------------------------------------
function nowInTimezone(tz) {
  const str = new Date().toLocaleString("en-US", { timeZone: tz });
  return new Date(str);
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------
const CRON_FILE = resolve(process.cwd(), "cron.json");
const CRON_ENABLED = process.env.CRON_ENABLED === "true" || process.env.CRON_ENABLED === "1";
let config = { timezone: "UTC", jobs: [] };
let parsedJobs = [];

function loadConfig() {
  if (!CRON_ENABLED || !existsSync(CRON_FILE)) return;

  try {
    const raw = readFileSync(CRON_FILE, "utf-8");
    config = JSON.parse(raw);
    config.timezone = config.timezone || "UTC";
    config.jobs = config.jobs || [];

    parsedJobs = config.jobs
      .filter((j) => j.enabled !== false)
      .map((j) => ({
        ...j,
        parsed: parseCron(j.schedule),
      }));
  } catch (err) {
    parsedJobs = [];
  }
}

loadConfig();

// Reload config when file changes
if (existsSync(CRON_FILE)) {
  watchFile(CRON_FILE, { interval: 5000 }, () => {
    loadConfig();
  });
}

// ---------------------------------------------------------------------------
// Scheduler — checks every 60 seconds
// ---------------------------------------------------------------------------
const lastFired = new Map();

function getMinuteKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

async function checkSchedule(session) {
  if (parsedJobs.length === 0) return;

  const now = nowInTimezone(config.timezone);
  const minuteKey = getMinuteKey(now);

  for (const job of parsedJobs) {
    if (!cronMatches(job.parsed, now)) continue;

    const firedKey = `${job.id}:${minuteKey}`;
    if (lastFired.has(firedKey)) continue;

    lastFired.set(firedKey, true);

    await session.log(`⏰ [cron] Running: ${job.id} (${job.schedule})`);

    try {
      await session.send({
        prompt: `[Scheduled Task: ${job.id}] ${job.prompt}`,
        mode: "enqueue",
      });
    } catch (err) {
      await session.log(`⚠️ [cron] Failed to send "${job.id}": ${err.message}`, {
        level: "warning",
      });
    }
  }

  // Cleanup old fired keys (keep last 120 minutes)
  if (lastFired.size > 500) {
    const entries = [...lastFired.keys()];
    for (let i = 0; i < entries.length - 120; i++) {
      lastFired.delete(entries[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (!CRON_ENABLED) {
        return {
          additionalContext:
            "[cron-scheduler] Cron is DISABLED (set CRON_ENABLED=true to activate). " +
            "Jobs in cron.json will not run.",
        };
      }

      loadConfig();
      const enabledCount = parsedJobs.length;
      const totalCount = config.jobs.length;

      if (totalCount === 0) {
        return {
          additionalContext:
            "[cron-scheduler] Cron is enabled but no cron.json found or no jobs configured.",
        };
      }

      return {
        additionalContext:
          `[cron-scheduler] Loaded ${enabledCount}/${totalCount} cron jobs ` +
          `(timezone: ${config.timezone}). ` +
          `Jobs: ${parsedJobs.map((j) => `${j.id} (${j.schedule})`).join(", ")}`,
      };
    },
  },

  tools: [
    {
      name: "cron_list_jobs",
      description:
        "List all configured cron jobs with their schedules and status.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        loadConfig();
        if (config.jobs.length === 0) {
          return "No cron jobs configured. Create cron.json in the repo root.";
        }

        const lines = config.jobs.map((j) => {
          const status = j.enabled === false ? "disabled" : "enabled";
          return `• ${j.id}: ${j.schedule} [${status}]\n  "${j.prompt}"`;
        });

        return (
          `Timezone: ${config.timezone}\n\n` +
          lines.join("\n\n")
        );
      },
    },
    {
      name: "cron_next_run",
      description:
        "Show when each enabled cron job will next fire.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        loadConfig();
        if (parsedJobs.length === 0) return "No enabled cron jobs.";

        const now = nowInTimezone(config.timezone);
        const lines = parsedJobs.map((j) => {
          // Find next matching minute in the next 24 hours
          const check = new Date(now);
          check.setSeconds(0, 0);
          for (let i = 1; i <= 1440; i++) {
            check.setMinutes(check.getMinutes() + 1);
            if (cronMatches(j.parsed, check)) {
              const timeStr = check.toLocaleString("en-US", {
                timeZone: config.timezone,
                hour: "2-digit",
                minute: "2-digit",
                weekday: "short",
                hour12: true,
              });
              return `• ${j.id}: next at ${timeStr} (${config.timezone})`;
            }
          }
          return `• ${j.id}: no match in next 24h`;
        });

        return lines.join("\n");
      },
    },
  ],
});

// Start the scheduler loop
if (!CRON_ENABLED) {
  await session.log(
    "⏰ Cron scheduler: disabled (set CRON_ENABLED=true to activate)"
  );
} else if (parsedJobs.length > 0) {
  await session.log(
    `⏰ Cron scheduler active: ${parsedJobs.length} job(s) loaded`
  );

  setInterval(() => {
    checkSchedule(session).catch((err) => {
      session.log(`⚠️ [cron] Scheduler error: ${err.message}`, {
        level: "warning",
      });
    });
  }, 60_000);

  // Check immediately on startup
  checkSchedule(session).catch(() => {});
} else {
  await session.log(
    "⏰ Cron scheduler: enabled but no jobs configured (create cron.json)"
  );
}

} // end BRIDGE_MODE check
