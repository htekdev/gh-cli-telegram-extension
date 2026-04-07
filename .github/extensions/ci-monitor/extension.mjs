// Extension: ci-monitor
// Monitors PR CI checks after push/PR creation, reports status + VM deployment
// details back to the session regardless of success or failure.
// Uses `gh pr checks --watch` to efficiently wait for check completion.

import { execFile } from "node:child_process";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

// session reference set after joinSession — enables session.log()
let _session = null;

// Internal debug log — only goes to stderr, never shown to user
function log(msg, level = "info") {
  console.error(`[ci-monitor] ${msg}`);
}

// Visible log — shown in UI but does NOT trigger an agent turn
function logToSession(msg) {
  if (_session?.log) {
    _session.log(msg, { level: "info" });
  }
  console.error(`[ci-monitor] ${msg}`);
}

function runGh(args, cwd, timeoutMs = 30_000) {
  log(`gh ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    execFile("gh", args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        log(`gh command failed: ${stderr || err.message}`);
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function getRepoRoot() {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--show-toplevel"], { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? process.cwd() : stdout.trim());
    });
  });
}

async function getPrNumber(cwd) {
  try {
    const result = await runGh(
      ["pr", "view", "--json", "number", "--jq", ".number"],
      cwd
    );
    return result || null;
  } catch {
    return null;
  }
}

// ── Check status (uses --watch to block until all checks complete) ─────────

async function waitForChecks(cwd, requirePending = false) {
  log("Waiting for checks to appear before starting --watch...");

  // Wait for at least one check to be registered (max 1 hour, every 30s).
  // Concurrency protection may queue the run, so checks can take a while to appear.
  for (let i = 0; i < 120; i++) {
    const checks = await getCheckResults(cwd);
    if (checks && checks.length > 0) {
      const pending = checks.filter(
        (c) => c.state === "PENDING" || c.state === "QUEUED" || c.state === "IN_PROGRESS"
      );
      if (pending.length > 0) {
        log(`${checks.length} check(s) found, ${pending.length} pending — starting --watch`);
        break;
      }
      if (requirePending) {
        // Auto-start mode: all checks are done, wait for new ones
        log(`${checks.length} check(s) found but all completed — waiting for new run (attempt ${i + 1}/120)...`);
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      log(`${checks.length} check(s) found — starting --watch`);
      break;
    }
    if (i === 119) {
      log("No checks appeared after 1 hour — aborting", "warning");
      return false;
    }
    log(`No checks yet, retrying in 30s (attempt ${i + 1}/120)...`);
    await new Promise((r) => setTimeout(r, 30_000));
  }

  log("Running gh pr checks --watch...");
  try {
    // --watch blocks until all checks finish. Exits 0 if all pass, non-zero otherwise.
    // Timeout set to 35 min to cover long deploys.
    await runGh(
      ["pr", "checks", "--watch", "--interval", "15"],
      cwd,
      35 * 60 * 1000
    );
    log("All checks passed (--watch exited 0)");
    return true;
  } catch {
    log("Some checks failed (--watch exited non-zero)", "warning");
    return false;
  }
}

async function getCheckResults(cwd) {
  try {
    const raw = await runGh(
      ["pr", "checks", "--json", "name,state,description,link,completedAt"],
      cwd
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getFailedJobLogs(cwd, checks) {
  const failed = (checks || []).filter(
    (c) => c.state === "FAILURE" || c.state === "ERROR"
  );

  const logs = [];
  for (const check of failed.slice(0, 3)) {
    try {
      const runIdMatch = check.link?.match(/\/runs\/(\d+)/);
      if (!runIdMatch) continue;
      const runId = runIdMatch[1];

      const jobsRaw = await runGh(
        ["run", "view", runId, "--json", "jobs"],
        cwd
      );
      const jobs = JSON.parse(jobsRaw).jobs || [];
      const failedJobs = jobs.filter((j) => j.conclusion === "failure");

      for (const job of failedJobs.slice(0, 2)) {
        try {
          const logText = await runGh(
            ["run", "view", runId, "--log-failed", "--job", String(job.databaseId)],
            cwd,
            60_000
          );
          logs.push({
            checkName: check.name,
            jobName: job.name,
            log: logText.slice(-3000),
          });
        } catch {
          logs.push({
            checkName: check.name,
            jobName: job.name,
            log: "(could not retrieve logs)",
          });
        }
      }
    } catch {
      // skip individual check log failures
    }
  }
  return logs;
}

// ── Deployment details extraction ──────────────────────────────────────────

async function getLatestDeployRun(cwd) {
  log("Fetching latest deploy workflow run for current branch...");
  try {
    // Get the current branch name so we only look at deploy runs for THIS branch
    const branch = await new Promise((resolve) => {
      execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 5_000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim());
      });
    });

    const args = [
      "run", "list", "--workflow", "deploy.yml", "--limit", "1",
      "--json", "databaseId,conclusion,status,url,headBranch,displayTitle,event",
    ];
    if (branch) {
      args.push("--branch", branch);
      log(`Filtering deploy runs to branch: ${branch}`);
    }

    const raw = await runGh(args, cwd);
    const runs = JSON.parse(raw);
    if (runs.length > 0) {
      log(`Found deploy run #${runs[0].databaseId} (branch: ${runs[0].headBranch}) — status: ${runs[0].status}, conclusion: ${runs[0].conclusion}`);
      return runs[0];
    }
    log("No deploy runs found for current branch");
    return null;
  } catch (e) {
    log(`Failed to fetch deploy runs: ${e.message}`);
    return null;
  }
}

async function getDeploymentDetails(cwd, runId) {
  log(`Waiting for deploy run #${runId} to complete before fetching logs...`);
  // Poll until the run completes (max 35 min, every 30s)
  for (let i = 0; i < 70; i++) {
    try {
      const raw = await runGh(
        ["run", "view", String(runId), "--json", "status,conclusion"],
        cwd
      );
      const run = JSON.parse(raw);
      if (run.status === "completed") {
        log(`Deploy run #${runId} completed (conclusion: ${run.conclusion})`);
        break;
      }
      log(`Deploy run #${runId} still ${run.status}, waiting 30s (attempt ${i + 1}/70)...`);
      await new Promise((r) => setTimeout(r, 30_000));
    } catch (e) {
      log(`Error polling run status: ${e.message}, retrying...`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }

  log(`Fetching run log for deploy run #${runId}...`);
  try {
    const logText = await runGh(
      ["run", "view", String(runId), "--log"],
      cwd,
      60_000
    );
    log(`Run log fetched (${logText.length} chars), parsing deployment details...`);

    const details = {
      ip: null,
      instanceId: null,
      environment: null,
      healthChecks: [],
      verificationResult: null,
      summary: null,
    };

    // Extract the structured summary between markers
    const summaryMatch = logText.match(
      /---DEPLOY-SUMMARY-START---([\s\S]*?)---DEPLOY-SUMMARY-END---/
    );
    if (summaryMatch) {
      // Clean ANSI codes and GH Actions log prefixes (e.g. "Deploy (poc)\tDeployment summary\t2026-...")
      details.summary = summaryMatch[1]
        .split("\n")
        .map((line) => line.replace(/^.*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, ""))
        .join("\n")
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trim();
      log(`Extracted deploy summary (${details.summary.length} chars)`);
    }

    for (const line of logText.split("\n")) {
      const ipMatch = line.match(/instance_ip=([\d.]+)/);
      if (ipMatch) details.ip = ipMatch[1];

      const idMatch = line.match(/instance_id=(i-[a-z0-9]+)/);
      if (idMatch) details.instanceId = idMatch[1];

      const envMatch = line.match(/environment=(\w+)/);
      if (envMatch && !details.environment) details.environment = envMatch[1];

      const checkMatch = line.match(/(✅ PASS|❌ FAIL): (.+)/);
      if (checkMatch) details.healthChecks.push(`${checkMatch[1]}: ${checkMatch[2]}`);

      if (line.includes("DEPLOYMENT VERIFICATION PASSED"))
        details.verificationResult = "PASSED";
      if (line.includes("DEPLOYMENT VERIFICATION FAILED"))
        details.verificationResult = "FAILED";
    }

    log(
      `Parsed: env=${details.environment}, ip=${details.ip}, id=${details.instanceId}, ` +
      `checks=${details.healthChecks.length}, verification=${details.verificationResult}, ` +
      `hasSummary=${!!details.summary}`
    );
    return details;
  } catch (e) {
    log(`Failed to fetch/parse run log: ${e.message}`);
    return null;
  }
}

function formatDeploySummary(run, details) {
  const statusIcon =
    run.conclusion === "success" ? "✅" :
    run.conclusion === "failure" ? "❌" :
    run.conclusion === "cancelled" ? "⚠️" : "❓";

  let msg = `\n--- VM Deployment Details ---\n`;
  msg += `${statusIcon} Deploy **${(run.conclusion || run.status || "unknown").toUpperCase()}**\n`;

  // Use the structured summary if available (much better context)
  if (details?.summary) {
    msg += `\n${details.summary}\n`;
  } else if (details) {
    if (details.environment) msg += `  Environment: \`${details.environment}\`\n`;
    if (details.ip) msg += `  Public IP: \`${details.ip}\`\n`;
    if (details.instanceId) msg += `  Instance ID: \`${details.instanceId}\`\n`;
    if (details.ip) msg += `  SSH: \`ssh -i openclaw-key.pem ubuntu@${details.ip}\`\n`;

    if (details.healthChecks.length > 0) {
      msg += `\n  Health Checks:\n`;
      for (const check of details.healthChecks) {
        msg += `    ${check}\n`;
      }
    }

    if (details.verificationResult) {
      msg += `\n  Verification: **${details.verificationResult}**\n`;
    }
  } else {
    msg += `  (could not extract VM details from run log)\n`;
  }

  if (run.url) msg += `\n  Run: ${run.url}\n`;

  return msg;
}

// ── Monitoring ─────────────────────────────────────────────────────────────

async function monitorChecks(cwd, notify, requirePending = false) {
  log("Starting CI monitoring (--watch mode)...");
  logToSession("⏳ Watching CI checks — will notify when complete...");

  // --watch blocks until all checks complete
  await waitForChecks(cwd, requirePending);

  // Fetch final check results
  log("Checks finished — fetching final results...");
  const checks = await getCheckResults(cwd);
  const failed = (checks || []).filter(
    (c) => c.state === "FAILURE" || c.state === "ERROR"
  );
  const succeeded = (checks || []).filter((c) => c.state === "SUCCESS");

  log(`Final results: ${succeeded.length} passed, ${failed.length} failed`);

  let summary = "";

  if (failed.length > 0) {
    log(`${failed.length} check(s) failed, fetching logs...`, "warning");
    const logs = await getFailedJobLogs(cwd, checks);
    summary =
      `❌ CI FAILED — ${failed.length} check(s) failed, ${succeeded.length} passed.\n\n` +
      failed
        .map((c) => `  ❌ ${c.name}: ${c.state} — ${c.link || "no URL"}`)
        .join("\n") +
      (logs.length > 0
        ? "\n\n--- Failed Job Logs ---\n" +
          logs
            .map(
              (l) =>
                `### ${l.checkName} / ${l.jobName}\n\`\`\`\n${l.log}\n\`\`\``
            )
            .join("\n\n")
        : "");
  } else {
    summary = `✅ CI PASSED — all ${succeeded.length} check(s) succeeded.\n`;
  }

  // Always fetch and include deployment details regardless of status
  log("Fetching deployment details...");
  const deployRun = await getLatestDeployRun(cwd);
  if (deployRun) {
    if (lastNotifiedRunId === deployRun.databaseId) {
      log(`Already notified for run #${deployRun.databaseId} — skipping duplicate`);
      return;
    }
    const details = await getDeploymentDetails(cwd, deployRun.databaseId);
    summary += formatDeploySummary(deployRun, details);
    lastNotifiedRunId = deployRun.databaseId;
  } else {
    log("No deploy run found — skipping VM details");
  }

  if (failed.length > 0) {
    summary += "\n\nPlease fix the CI failures above and push again.";
  }

  log("Sending notification to session...");
  notify(summary);

  // Start polling for PR comments (feedback from deployed agent)
  const prNum = await getPrNumber(cwd);
  if (prNum) {
    startCommentPolling(cwd, prNum, notify);
  }
}

// ── PR Comment Polling (feedback loop from deployed agent) ─────────────────

let commentPollActive = false;

async function getLatestComments(cwd, prNum, since) {
  try {
    const raw = await runGh(
      ["pr", "view", String(prNum), "--json", "comments", "--jq",
       ".comments | map(select(.createdAt > \"" + since + "\")) | map({author: .author.login, body: .body, createdAt: .createdAt})"],
      cwd
    );
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

async function startCommentPolling(cwd, prNum, notify) {
  if (commentPollActive) {
    log("Comment polling already active");
    return;
  }
  commentPollActive = true;
  log(`Starting PR #${prNum} comment polling (every 60s)...`);

  // Start from now — only pick up NEW comments
  let lastCheck = new Date().toISOString();

  const poll = async () => {
    while (commentPollActive) {
      await new Promise((r) => setTimeout(r, 60_000));
      try {
        const newComments = await getLatestComments(cwd, prNum, lastCheck);
        for (const comment of newComments) {
          log(`New PR comment from @${comment.author}: ${comment.body.slice(0, 80)}...`);
          notify(
            `💬 New comment on PR #${prNum} from **@${comment.author}**:\n\n${comment.body}`
          );
          lastCheck = comment.createdAt;
        }
      } catch (e) {
        log(`Comment poll error: ${e.message}`);
      }
    }
  };

  poll().catch((e) => {
    log(`Comment polling stopped: ${e.message}`);
    commentPollActive = false;
  });
}

let activePoll = null;
let lastNotifiedRunId = null;

function startMonitoring(cwd, notify, requirePending = false) {
  if (activePoll) {
    log("Monitoring already active, skipping duplicate start");
    return;
  }
  log("Starting background CI monitoring...");
  activePoll = monitorChecks(cwd, notify, requirePending).finally(() => {
    log("Background monitoring finished");
    activePoll = null;
  });
}

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onSessionStart: async () => {
      log("Extension loaded — monitoring git push and PR creation events");
    },
    onPostToolUse: async (input) => {
      // Detect git push (via hookflow or direct)
      if (input.toolName === "powershell") {
        const cmd = String(input.toolArgs?.command || "");
        if (
          /\bgit\b.*\bpush\b/i.test(cmd) ||
          /\bhookflow\s+git-push\b/i.test(cmd)
        ) {
          log("Git push detected, checking for PR...");
          const cwd = await getRepoRoot();
          const prNum = await getPrNumber(cwd);
          if (prNum) {
            log(`PR #${prNum} found — starting CI monitoring`);
            startMonitoring(cwd, (msg) => {
              session.send({ prompt: msg }).catch((e) =>
                console.error("[ci-monitor] send failed:", e.message)
              );
            });
            return {
              additionalContext:
                `🚀 CI watch started for PR #${prNum}`,
            };
          } else {
            log("No PR found for current branch — skipping monitoring");
          }
        }
      }

      // Detect PR creation
      if (input.toolName === "create_pr") {
        log("PR creation detected — will start monitoring in 5s");
        const cwd = await getRepoRoot();
        setTimeout(() => {
          log("Delayed monitoring start firing...");
          startMonitoring(cwd, (msg) => {
            session.send({ prompt: msg }).catch((e) =>
              console.error("[ci-monitor] send failed:", e.message)
            );
          });
        }, 5_000);
        return {
          additionalContext:
            "🚀 CI watch started for new PR",
        };
      }
    },
  },
  tools: [
    {
      name: "check_ci_status",
      description:
        "Check the current CI/CD check status for the PR on the current branch. Returns check names, states, logs for failures, and VM deployment details (IP, instance ID, health checks).",
      parameters: { type: "object", properties: {} },
      skipPermission: true,
      handler: async () => {
        log("check_ci_status tool invoked");
        const cwd = await getRepoRoot();
        const prNum = await getPrNumber(cwd);
        if (!prNum) return "No PR found for the current branch.";

        const checks = await getCheckResults(cwd);
        if (!checks || checks.length === 0) return `PR #${prNum}: No checks found yet.`;

        const pending = checks.filter(
          (c) => c.state === "PENDING" || c.state === "QUEUED" || c.state === "IN_PROGRESS"
        );
        const failed = checks.filter(
          (c) => c.state === "FAILURE" || c.state === "ERROR"
        );
        const succeeded = checks.filter((c) => c.state === "SUCCESS");

        log(`check_ci_status: ${succeeded.length} passed, ${failed.length} failed, ${pending.length} pending`);

        let summary = `PR #${prNum} — ${succeeded.length} passed, ${failed.length} failed, ${pending.length} pending\n\n`;
        for (const c of checks) {
          const icon = c.state === "SUCCESS" ? "✅" : c.state === "FAILURE" || c.state === "ERROR" ? "❌" : "⏳";
          summary += `${icon} ${c.name}: ${c.state}\n`;
        }

        if (failed.length > 0) {
          const logs = await getFailedJobLogs(cwd, checks);
          if (logs.length > 0) {
            summary += "\n--- Failed Job Logs ---\n";
            for (const l of logs) {
              summary += `\n### ${l.checkName} / ${l.jobName}\n\`\`\`\n${l.log}\n\`\`\`\n`;
            }
          }
        }

        // Always include deployment details
        log("check_ci_status: fetching deployment details...");
        const deployRun = await getLatestDeployRun(cwd);
        if (deployRun) {
          const details = await getDeploymentDetails(cwd, deployRun.databaseId);
          summary += formatDeploySummary(deployRun, details);
        }

        return summary;
      },
    },
  ],
});

_session = session;
log("ci-monitor extension initialized");

// Auto-detect PR on init/reload — always start monitoring if on a PR branch.
// This catches pushes that happened before/during reload (onPostToolUse misses them).
// waitForChecks() handles the wait (up to 1 hour) if checks haven't appeared yet.
(async () => {
  const cwd = await getRepoRoot();
  const prNum = await getPrNumber(cwd);
  if (prNum) {
    log(`PR #${prNum} found on init — starting CI monitor`);
    startMonitoring(cwd, (msg) => {
      session.send({ prompt: msg }).catch((e) =>
        console.error("[ci-monitor] send failed:", e.message)
      );
    }, true);
  } else {
    log("No PR on current branch");
  }
})();
