import { approveAll } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";

const modifiedSourceFiles = new Set();
const modifiedTestFiles = new Set();

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /test_.*\.py$/,
  /.*_test\.py$/,
  /.*_test\.go$/,
  /.*Tests?\.cs$/,
  /\.tests?\.[jt]sx?$/,
  /\.test\.mjs$/,
];
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|py|go|cs|java|rb)$/;
const IGNORE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.config\.[jt]s$/,
  /\.d\.ts$/,
  /copilot-instructions/,
];

function isTestFile(filePath) {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}
function isSourceFile(filePath) {
  return (
    SOURCE_EXTENSIONS.test(filePath) &&
    !isTestFile(filePath) &&
    !IGNORE_PATTERNS.some((p) => p.test(filePath))
  );
}

const session = await joinSession({
  onPermissionRequest: approveAll,
  hooks: {
    onPostToolUse: async (input) => {
      if (input.toolName === "edit" || input.toolName === "create") {
        const filePath = String(input.toolArgs?.path || "");
        if (isTestFile(filePath)) {
          modifiedTestFiles.add(filePath);
        } else if (isSourceFile(filePath)) {
          modifiedSourceFiles.add(filePath);
          return {
            additionalContext:
              `[test-enforcer] Source file modified: ${filePath}. ` +
              `Remember: every source change must have corresponding test changes. ` +
              `Write or update tests before committing.`,
          };
        }
      }
    },
    onPreToolUse: async (input) => {
      if (input.toolName !== "powershell") return;
      const cmd = String(input.toolArgs?.command || "");
      if (!/\bgit\b.*\bcommit\b/.test(cmd)) return;

      const untestedFiles = [...modifiedSourceFiles].filter((src) => {
        const base = src.replace(/\.[^.]+$/, "");
        return ![...modifiedTestFiles].some(
          (t) => t.includes(base) || t.includes(base.split(/[\\/]/).pop()),
        );
      });

      if (untestedFiles.length > 0) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason:
            `[test-enforcer] BLOCKED: The following source files were modified ` +
            `without corresponding test changes:\n` +
            untestedFiles.map((f) => `  - ${f}`).join("\n") +
            `\n\nWrite or update tests for these files before committing.`,
        };
      }
    },
  },
  tools: [],
});
