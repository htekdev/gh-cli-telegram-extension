import { readFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { resolve } from "node:path";
import { parseCron, cronMatches, nowInTimezone } from "./parser.js";
import type { ParsedCron } from "./parser.js";
import type { SessionManager } from "../sessions/manager.js";

interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled?: boolean;
  channel?: "telegram" | "slack" | "all";
  chatId?: string;
}

interface CronConfig {
  timezone: string;
  jobs: CronJob[];
}

interface ParsedJob extends CronJob {
  parsed: ParsedCron;
}

interface ChannelTarget {
  name: string;
  sessionManager: SessionManager;
  defaultChatId: string | undefined;
}

/** Schedules cron jobs and dispatches prompts to channel sessions. */
export class CronScheduler {
  private readonly cronFile: string;
  private readonly channelTargets: Map<string, ChannelTarget>;
  private config: CronConfig = { timezone: "UTC", jobs: [] };
  private parsedJobs: ParsedJob[] = [];
  private lastFired = new Map<string, boolean>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    channelTargets: Map<string, ChannelTarget>,
    cwd: string = process.cwd(),
  ) {
    this.channelTargets = channelTargets;
    this.cronFile = resolve(cwd, "cron.json");
  }

  /** Start watching the cron config and evaluating schedules. */
  start(): void {
    this.loadConfig();

    // Watch for config changes
    if (existsSync(this.cronFile)) {
      watchFile(this.cronFile, { interval: 5000 }, () => {
        console.log("[cron] Config file changed, reloading...");
        this.loadConfig();
      });
    }

    if (this.parsedJobs.length === 0) {
      console.log("[cron] ⏰ No enabled cron jobs configured (will check on reload)");
    } else {
      console.log(`[cron] ⏰ Scheduler active: ${this.parsedJobs.length} job(s) loaded`);
    }

    // Always start the timer so hot-reloaded jobs get picked up
    this.interval = setInterval(() => {
      this.checkSchedule().catch((err) => {
        console.warn("[cron] Scheduler error:", err);
      });
    }, 60_000);

    // Check immediately
    this.checkSchedule().catch((err) => {
      console.warn("[cron] Initial schedule check failed:", err);
    });
  }

  /** Stop the scheduler and file watcher. */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (existsSync(this.cronFile)) {
      unwatchFile(this.cronFile);
    }
  }

  private loadConfig(): void {
    if (!existsSync(this.cronFile)) {
      this.parsedJobs = [];
      return;
    }

    try {
      const raw = readFileSync(this.cronFile, "utf-8");
      this.config = JSON.parse(raw) as CronConfig;
      this.config.timezone = this.config.timezone || "UTC";
      this.config.jobs = this.config.jobs || [];

      // Validate timezone early
      try {
        nowInTimezone(this.config.timezone);
      } catch {
        console.error(`[cron] Invalid timezone "${this.config.timezone}" in cron.json — disabling all jobs`);
        this.parsedJobs = [];
        return;
      }

      // Parse each job independently so one bad schedule doesn't disable all jobs
      this.parsedJobs = [];
      for (const job of this.config.jobs) {
        if (job.enabled === false) continue;
        try {
          this.parsedJobs.push({ ...job, parsed: parseCron(job.schedule) });
        } catch (parseErr) {
          console.warn(`[cron] Skipping job "${job.id}" — invalid schedule "${job.schedule}":`, parseErr);
        }
      }
    } catch (err) {
      console.warn("[cron] Failed to load config:", err);
      this.parsedJobs = [];
    }
  }

  private async checkSchedule(): Promise<void> {
    if (this.parsedJobs.length === 0) return;

    const now = nowInTimezone(this.config.timezone);
    const minuteKey = this.getMinuteKey(now);

    for (const job of this.parsedJobs) {
      if (!cronMatches(job.parsed, now)) continue;

      const firedKey = `${job.id}:${minuteKey}`;
      if (this.lastFired.has(firedKey)) continue;

      this.lastFired.set(firedKey, true);

      console.log(`[cron] ⏰ Running: ${job.id} (${job.schedule}) → ${job.channel || "all"}`);

      // Determine which channels to target
      const targets = this.getTargetsForJob(job);

      for (const target of targets) {
        const chatId = job.chatId || target.defaultChatId;
        if (!chatId) {
          console.warn(`[cron] No chatId for job "${job.id}" on channel "${target.name}", skipping`);
          continue;
        }

        try {
          await target.sessionManager.sendToCronSession(
            chatId,
            job.id,
            `[Scheduled Task: ${job.id}] ${job.prompt}`,
          );
        } catch (err) {
          console.warn(`[cron] Failed to send "${job.id}" to ${target.name}:`, err);
        }
      }
    }

    // Cleanup old fired keys
    if (this.lastFired.size > 500) {
      const entries = [...this.lastFired.keys()];
      for (let i = 0; i < entries.length - 120; i++) {
        this.lastFired.delete(entries[i]);
      }
    }
  }

  private getTargetsForJob(job: CronJob): ChannelTarget[] {
    const channelPref = job.channel || "all";

    if (channelPref === "all") {
      return Array.from(this.channelTargets.values());
    }

    const target = this.channelTargets.get(channelPref);
    return target ? [target] : [];
  }

  private getMinuteKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
  }

  /** Return a formatted list of configured jobs. */
  listJobs(): string {
    this.loadConfig();
    if (this.config.jobs.length === 0) {
      return "No cron jobs configured. Create cron.json in the repo root.";
    }

    const lines = this.config.jobs.map((j) => {
      const status = j.enabled === false ? "disabled" : "enabled";
      const ch = j.channel || "all";
      const chatTarget = j.chatId ? ` → ${j.chatId}` : "";
      return `• ${j.id}: ${j.schedule} [${status}] (${ch}${chatTarget})\n  "${j.prompt}"`;
    });

    return `Timezone: ${this.config.timezone}\n\n${lines.join("\n\n")}`;
  }

  /** Return formatted next-run times for each enabled job. */
  nextRuns(): string {
    this.loadConfig();
    if (this.parsedJobs.length === 0) return "No enabled cron jobs.";

    const now = nowInTimezone(this.config.timezone);
    const lines = this.parsedJobs.map((j) => {
      const check = new Date(now);
      check.setSeconds(0, 0);
      for (let i = 1; i <= 1440; i++) {
        check.setMinutes(check.getMinutes() + 1);
        if (cronMatches(j.parsed, check)) {
          const timeStr = check.toLocaleString("en-US", {
            timeZone: this.config.timezone,
            hour: "2-digit",
            minute: "2-digit",
            weekday: "short",
            hour12: true,
          });
          return `• ${j.id}: next at ${timeStr} (${this.config.timezone})`;
        }
      }
      return `• ${j.id}: no match in next 24h`;
    });

    return lines.join("\n");
  }
}
