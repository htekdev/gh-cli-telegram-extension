import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

const isWindows = process.platform === "win32";

function findProjectRoot(startPath) {
  let dir = dirname(startPath);
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(resolve(dir, "package.json")) ||
      existsSync(resolve(dir, "pyproject.toml")) ||
      existsSync(resolve(dir, ".git"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function detectLinter(filePath, projectRoot) {
  const ext = filePath.match(/\.([^.]+)$/)?.[1];
  if (["ts", "tsx", "js", "jsx", "mjs"].includes(ext)) {
    if (
      existsSync(resolve(projectRoot, "eslint.config.mjs")) ||
      existsSync(resolve(projectRoot, "eslint.config.js")) ||
      existsSync(resolve(projectRoot, ".eslintrc.json")) ||
      existsSync(resolve(projectRoot, ".eslintrc.js"))
    ) {
      const npx = isWindows ? "npx.cmd" : "npx";
      return { cmd: npx, args: ["eslint", "--no-error-on-unmatched-pattern", filePath] };
    }
  }
  if (ext === "py") {
    return { cmd: "ruff", args: ["check", filePath] };
  }
  if (ext === "cs") {
    return { cmd: "dotnet", args: ["format", "--verify-no-changes", "--include", filePath] };
  }
  return null;
}

function runLinter(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve(stdout || stderr || err.message);
      else resolve(null);
    });
  });
}

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onPostToolUse: async (input) => {
      if (input.toolName !== "edit") return;
      const filePath = String(input.toolArgs?.path || "");
      if (!filePath) return;

      const projectRoot = findProjectRoot(filePath);
      const linter = detectLinter(filePath, projectRoot);
      if (!linter) return;

      const result = await runLinter(linter.cmd, linter.args, projectRoot);
      if (result) {
        return {
          additionalContext:
            `[lint-on-edit] Lint issues found in ${filePath}:\n${result}\n` +
            `Fix these issues before proceeding.`,
        };
      }
    },
  },
  tools: [],
});
